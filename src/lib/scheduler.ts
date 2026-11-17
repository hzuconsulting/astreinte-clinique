/**
 * Générateur de planning d'astreinte.
 *
 * Le problème : un médecin par jour, jamais un absent, jamais (sauf impossibilité)
 * un médecin sur son jour non travaillé, et le tout le plus équitable possible
 * sur l'année — d'abord les jours fériés, puis les week-ends, puis le total —
 * en évitant les astreintes trop rapprochées.
 *
 * La méthode :
 *  1. Le calendrier est découpé en « blocs » : un week-end (et le pont férié
 *     qui le prolonge) est un bloc confié à une seule personne ; un jour de
 *     semaine est un bloc d'un jour. Les jours verrouillés à la main sont fixes.
 *  2. Une fonction de coût mesure l'iniquité de l'année entière (historique
 *     compris) et les contraintes molles.
 *  3. Une construction gloutonne (fériés d'abord, puis week-ends, puis le
 *     reste) donne une première solution, qu'un recuit simulé améliore en
 *     réattribuant ou en échangeant des blocs. Plusieurs essais, on garde le
 *     meilleur. Tout est déterministe pour une graine donnée.
 */
import { addDays, eachDay, weekday, type ISODate } from './dates';
import { holidayIndex, isOnCallWeekend, unavailability, yearOf, type Assignment, type PlanState } from './model';

export const WEIGHTS = {
  holiday: 6,
  weekend: 3,
  total: 1,
  weekday: 0.3,
  rest: 4,
  off: 500,
};

export interface Warning {
  date: ISODate;
  message: string;
}

export interface GenerateResult {
  assignments: Record<ISODate, Assignment>;
  warnings: Warning[];
  cost: number;
}

export interface GenerateOptions {
  from: ISODate;
  to: ISODate;
  seed?: number;
  restarts?: number;
  /** Remplace aussi les jours déjà attribués (non verrouillés) dans la plage. Vrai par défaut. */
  replaceUnlocked?: boolean;
}

/** PRNG reproductible (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Évalue un planning sur une fenêtre (l'année ou les années concernées).
 * La « timeline » contient, pour chaque jour de la fenêtre, l'index du médecin
 * d'astreinte (-1 si personne).
 */
export class Evaluator {
  readonly days: ISODate[];
  readonly index = new Map<ISODate, number>();
  readonly nd: number;
  readonly timeline: Int16Array;
  private readonly weekendFlag: Uint8Array;
  private readonly holidayFlag: Uint8Array;
  private readonly wd: Uint8Array;
  private readonly blockOf: Int32Array;
  private readonly off: Uint8Array; // nd * 7
  private readonly w: number[];
  private readonly minRest: number;

  constructor(readonly state: PlanState, windowFrom: ISODate, windowTo: ISODate) {
    this.days = eachDay(windowFrom, windowTo);
    this.days.forEach((d, i) => this.index.set(d, i));
    this.nd = state.doctors.length;
    const n = this.days.length;
    const holidays = holidayIndex(state.settings, yearOf(windowFrom) - 1, yearOf(windowTo) + 1);
    this.weekendFlag = new Uint8Array(n);
    this.holidayFlag = new Uint8Array(n);
    this.wd = new Uint8Array(n);
    this.blockOf = new Int32Array(n);
    this.timeline = new Int16Array(n).fill(-1);
    this.days.forEach((d, i) => {
      this.weekendFlag[i] = isOnCallWeekend(d, state.settings) ? 1 : 0;
      this.holidayFlag[i] = holidays.has(d) ? 1 : 0;
      this.wd[i] = weekday(d);
      const special = this.weekendFlag[i] || this.holidayFlag[i];
      const prevSpecial = i > 0 && (this.weekendFlag[i - 1] || this.holidayFlag[i - 1]);
      this.blockOf[i] = state.settings.groupWeekends && special && prevSpecial ? this.blockOf[i - 1]! : i;
    });
    this.off = new Uint8Array(this.nd * 7);
    state.doctors.forEach((doc, k) => doc.offWeekdays.forEach((x) => (this.off[k * 7 + x] = 1)));
    this.w = state.doctors.map((d) => Math.max(0.05, (d.share || 100) / 100));
    this.minRest = Math.max(0, state.settings.minRest | 0);
    const docIndex = new Map(state.doctors.map((d, k) => [d.id, k]));
    for (const [date, a] of Object.entries(state.assignments)) {
      const i = this.index.get(date);
      const k = docIndex.get(a.doctorId);
      if (i !== undefined && k !== undefined) this.timeline[i] = k;
    }
  }

  isHoliday(i: number): boolean {
    return this.holidayFlag[i] === 1;
  }
  isWeekendIdx(i: number): boolean {
    return this.weekendFlag[i] === 1;
  }
  block(i: number): number {
    return this.blockOf[i]!;
  }

  private spread(values: Float64Array): number {
    let mean = 0;
    for (let k = 0; k < this.nd; k++) mean += values[k]! / this.w[k]!;
    mean /= this.nd;
    let s = 0;
    for (let k = 0; k < this.nd; k++) {
      const v = values[k]! / this.w[k]! - mean;
      s += v * v;
    }
    return s;
  }

  cost(): number {
    const nd = this.nd;
    if (nd === 0) return 0;
    const tot = new Float64Array(nd);
    const we = new Float64Array(nd);
    const ho = new Float64Array(nd);
    const wdc = new Float64Array(nd * 7);
    const last = new Int32Array(nd).fill(-1_000_000);
    const lastBlock = new Int32Array(nd).fill(-1);
    let rest = 0;
    let off = 0;
    const tl = this.timeline;
    const limit = this.minRest;
    for (let i = 0; i < tl.length; i++) {
      const d = tl[i]!;
      if (d < 0) continue;
      tot[d]!++;
      if (this.weekendFlag[i]) we[d]!++;
      if (this.holidayFlag[i]) ho[d]!++;
      const x = this.wd[i]!;
      wdc[d * 7 + x]!++;
      if (this.off[d * 7 + x]) off++;
      const gap = i - last[d]!;
      if (gap <= limit && this.blockOf[i] !== lastBlock[d]) {
        const p = limit + 1 - gap;
        rest += p * p;
      }
      last[d] = i;
      lastBlock[d] = this.blockOf[i]!;
    }
    let wdSpread = 0;
    const col = new Float64Array(nd);
    for (let x = 0; x < 7; x++) {
      for (let k = 0; k < nd; k++) col[k] = wdc[k * 7 + x]!;
      wdSpread += this.spread(col);
    }
    return (
      WEIGHTS.holiday * this.spread(ho) +
      WEIGHTS.weekend * this.spread(we) +
      WEIGHTS.total * this.spread(tot) +
      WEIGHTS.weekday * wdSpread +
      WEIGHTS.rest * rest +
      WEIGHTS.off * off
    );
  }
}

interface Unit {
  idx: number[]; // indices dans la fenêtre
  allowed: number[]; // médecins possibles (absences exclues)
  priority: number; // 2 = contient un férié, 1 = week-end, 0 = semaine
}

export function fairnessWindow(from: ISODate, to: ISODate): { from: ISODate; to: ISODate } {
  return { from: `${yearOf(from)}-01-01`, to: `${yearOf(to)}-12-31` };
}

export function generate(state: PlanState, opts: GenerateOptions): GenerateResult {
  const { from, to } = opts;
  const replace = opts.replaceUnlocked ?? true;
  const win = fairnessWindow(from, to);

  // Les jours de la plage qu'on va (re)calculer sont retirés de l'historique.
  const base: PlanState = { ...state, assignments: { ...state.assignments } };
  const free = new Set<ISODate>();
  for (const d of eachDay(from, to)) {
    const a = base.assignments[d];
    if (a?.locked) continue;
    if (a && !replace && state.doctors.some((doc) => doc.id === a.doctorId)) continue;
    delete base.assignments[d];
    free.add(d);
  }

  const ev = new Evaluator(base, win.from, win.to);
  const nd = ev.nd;
  const warnings: Warning[] = [];
  if (nd === 0) return { assignments: {}, warnings: [{ date: from, message: 'Aucun médecin dans l’équipe.' }], cost: 0 };

  // Disponibilité (absences = interdit ; jour non travaillé = autorisé mais très pénalisé).
  const absent = (k: number, d: ISODate) => unavailability(state, state.doctors[k]!.id, d)?.kind === 'absence';
  const offDay = (k: number, d: ISODate) => state.doctors[k]!.offWeekdays.includes(weekday(d));

  // Découpage en blocs.
  const units: Unit[] = [];
  const pushUnit = (dates: ISODate[]) => {
    const idx = dates.map((d) => ev.index.get(d)!);
    const all = [...Array(nd).keys()];
    const allowed = all.filter((k) => dates.every((d) => !absent(k, d)));
    const clean = allowed.filter((k) => dates.every((d) => !offDay(k, d)));
    if (dates.length > 1 && clean.length === 0) {
      // Personne ne peut tenir tout le bloc proprement : on le découpe jour par jour.
      dates.forEach((d) => pushUnit([d]));
      return;
    }
    const d0 = dates[0]!;
    if (allowed.length === 0) {
      warnings.push({ date: d0, message: 'Personne n’est disponible (tout le monde est absent).' });
      return;
    }
    if (clean.length === 0) {
      warnings.push({ date: d0, message: 'Tous les présents ont ce jour comme non travaillé : attribué quand même.' });
    }
    const priority = idx.some((i) => ev.isHoliday(i)) ? 2 : idx.some((i) => ev.isWeekendIdx(i)) ? 1 : 0;
    // Jour non travaillé = interdit dès qu'un autre médecin peut prendre le bloc.
    units.push({ idx, allowed: clean.length > 0 ? clean : allowed, priority });
  };

  const freeSorted = [...free].sort();
  let run: ISODate[] = [];
  const flush = () => {
    if (run.length) pushUnit(run);
    run = [];
  };
  for (const d of freeSorted) {
    const i = ev.index.get(d)!;
    const prev = run[run.length - 1];
    if (prev && addDays(prev, 1) === d && ev.block(ev.index.get(prev)!) === ev.block(i)) {
      run.push(d);
    } else {
      flush();
      run.push(d);
    }
  }
  flush();

  const set = (u: Unit, k: number) => {
    for (const i of u.idx) ev.timeline[i] = k;
  };

  const restarts = Math.max(1, opts.restarts ?? 3);
  const seed0 = opts.seed ?? 1;
  let best: Int16Array | null = null;
  let bestCost = Infinity;

  for (let r = 0; r < restarts; r++) {
    const rand = rng(seed0 * 7919 + r * 104729);
    for (const u of units) set(u, -1);

    // 1. Glouton : fériés, puis week-ends, puis semaine ; ordre aléatoire à priorité égale.
    const order = units
      .map((u) => ({ u, key: u.priority * 10 + rand() }))
      .sort((a, b) => b.key - a.key)
      .map((x) => x.u);
    for (const u of order) {
      let bk = u.allowed[0]!;
      let bc = Infinity;
      for (const k of u.allowed) {
        set(u, k);
        const c = ev.cost() + rand() * 1e-6;
        if (c < bc) {
          bc = c;
          bk = k;
        }
      }
      set(u, bk);
    }

    // 2. Recuit simulé.
    let cur = ev.cost();
    let localBest = cur;
    let localSnap = ev.timeline.slice();
    const movable = units.filter((u) => u.allowed.length > 1);
    if (movable.length > 0) {
      const iters = Math.min(40_000, Math.max(3_000, movable.length * 120));
      const t0 = 4;
      const t1 = 0.01;
      for (let it = 0; it < iters; it++) {
        const temp = t0 * Math.pow(t1 / t0, it / iters);
        const u = movable[Math.floor(rand() * movable.length)]!;
        const ku = ev.timeline[u.idx[0]!]!;
        let undo: () => void;
        if (rand() < 0.5) {
          const v = movable[Math.floor(rand() * movable.length)]!;
          const kv = ev.timeline[v.idx[0]!]!;
          if (v === u || kv === ku || !u.allowed.includes(kv) || !v.allowed.includes(ku)) continue;
          set(u, kv);
          set(v, ku);
          undo = () => {
            set(u, ku);
            set(v, kv);
          };
        } else {
          const k = u.allowed[Math.floor(rand() * u.allowed.length)]!;
          if (k === ku) continue;
          set(u, k);
          undo = () => set(u, ku);
        }
        const c = ev.cost();
        if (c <= cur || rand() < Math.exp((cur - c) / temp)) {
          cur = c;
          if (c < localBest - 1e-9) {
            localBest = c;
            localSnap = ev.timeline.slice();
          }
        } else {
          undo();
        }
      }
    }
    if (localBest < bestCost) {
      bestCost = localBest;
      best = localSnap;
    }
  }

  const out: Record<ISODate, Assignment> = {};
  for (const [d, a] of Object.entries(base.assignments)) out[d] = a;
  if (best) {
    for (const u of units) {
      for (const i of u.idx) {
        const k = best[i]!;
        if (k >= 0) out[ev.days[i]!] = { doctorId: state.doctors[k]!.id, locked: false };
      }
    }
  }
  warnings.sort((a, b) => a.date.localeCompare(b.date));
  return { assignments: out, warnings, cost: bestCost };
}

export interface Suggestion {
  doctorId: string;
  /** Hausse du coût d'iniquité si on lui confie ce jour (plus bas = mieux). */
  delta: number;
  blocked: string | null;
  notes: string[];
}

/** Classe les médecins pour un jour donné, avec les raisons. */
export function suggest(state: PlanState, date: ISODate): Suggestion[] {
  const win = fairnessWindow(date, date);
  const without: PlanState = { ...state, assignments: { ...state.assignments } };
  delete without.assignments[date];
  const ev = new Evaluator(without, win.from, win.to);
  const i = ev.index.get(date)!;
  const base = ev.cost();
  const minRest = state.settings.minRest;
  const res = state.doctors.map((doc, k): Suggestion => {
    const u = unavailability(state, doc.id, date);
    const notes: string[] = [];
    let blocked: string | null = null;
    if (u?.kind === 'absence') blocked = u.label;
    if (u?.kind === 'off') notes.push('Jour non travaillé');
    for (let g = 1; g <= Math.max(1, minRest); g++) {
      const before = ev.timeline[i - g];
      const after = ev.timeline[i + g];
      if (before === k && ev.block(i - g) !== ev.block(i)) {
        notes.push(g === 1 ? 'D’astreinte la veille' : `D’astreinte il y a ${g} jours`);
        break;
      }
      if (after === k && ev.block(i + g) !== ev.block(i)) {
        notes.push(g === 1 ? 'D’astreinte le lendemain' : `D’astreinte dans ${g} jours`);
        break;
      }
    }
    ev.timeline[i] = k;
    const delta = ev.cost() - base;
    ev.timeline[i] = -1;
    return { doctorId: doc.id, delta, blocked, notes };
  });
  return res.sort((a, b) => (a.blocked ? 1 : 0) - (b.blocked ? 1 : 0) || a.delta - b.delta);
}
