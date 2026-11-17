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
import { holidayIndex, isOffDay, isOnCallWeekend, unavailability, yearOf, type Assignment, type PlanState } from './model';

export const WEIGHTS = {
  holiday: 6,
  weekend: 3,
  total: 1,
  weekday: 0.3,
  rest: 4,
  /** Deux week-ends d'affilée pour la même personne. */
  backToBack: 200,
  /** Par jour au-delà du maximum de jours consécutifs. */
  overRun: 300,
  off: 500,
  /**
   * Écart cumulé relevé à la fin de chaque mois. Un déséquilibre qui dure coûte
   * un peu plus chaque mois : il est donc rattrapé dès que possible.
   */
  monthlyHoliday: 3,
  monthlyWeekend: 1.5,
  monthlyTotal: 0.5,
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
  private readonly maxRun: number;
  private readonly avoidB2B: boolean;
  /** Numéro de semaine (lundi → dimanche) de chaque jour de la fenêtre. */
  private readonly week: Int32Array;
  private readonly monthEnd: Uint8Array;
  /** Dernier jour (index) où l'on relève l'écart mensuel : au-delà, rien n'est encore planifié. */
  checkpointUntil: number;

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
    this.week = new Int32Array(n);
    this.monthEnd = new Uint8Array(n);
    this.maxRun = Math.max(0, state.settings.maxConsecutive | 0);
    this.avoidB2B = state.settings.avoidBackToBackWeekends ?? true;
    const firstWd = n ? weekday(this.days[0]!) : 0;
    this.days.forEach((d, i) => {
      this.week[i] = Math.floor((i + firstWd) / 7);
      this.weekendFlag[i] = isOnCallWeekend(d, state.settings) ? 1 : 0;
      this.holidayFlag[i] = holidays.has(d) ? 1 : 0;
      this.wd[i] = weekday(d);
      const special = this.weekendFlag[i] || this.holidayFlag[i];
      const prevSpecial = i > 0 && (this.weekendFlag[i - 1] || this.holidayFlag[i - 1]);
      this.blockOf[i] = state.settings.groupWeekends && special && prevSpecial ? this.blockOf[i - 1]! : i;
    });
    if (this.maxRun > 0) this.splitLongBlocks();
    for (let i = 0; i < n; i++) this.monthEnd[i] = i === n - 1 || this.days[i + 1]!.endsWith('-01') ? 1 : 0;
    this.off = new Uint8Array(this.nd * 7);
    state.doctors.forEach((doc, k) => doc.offWeekdays.forEach((x) => isOffDay(state, doc, x) && (this.off[k * 7 + x] = 1)));
    this.w = state.doctors.map((d) => Math.max(0.05, (d.share || 100) / 100));
    this.minRest = Math.max(0, state.settings.minRest | 0);
    const docIndex = new Map(state.doctors.map((d, k) => [d.id, k]));
    for (const [date, a] of Object.entries(state.assignments)) {
      const i = this.index.get(date);
      const k = docIndex.get(a.doctorId);
      if (i !== undefined && k !== undefined) this.timeline[i] = k;
    }
    let lastAssigned = -1;
    this.timeline.forEach((k, i) => k >= 0 && (lastAssigned = i));
    this.checkpointUntil = lastAssigned;
  }

  /**
   * Un bloc plus long que le maximum de jours consécutifs (ex. ven. → lun. de
   * Pâques avec un maximum de 3) est coupé : on garde le week-end entier et on
   * détache les fériés accolés ; si le week-end seul dépasse encore, il est
   * coupé en tranches.
   */
  private splitLongBlocks(): void {
    const n = this.blockOf.length;
    let i = 0;
    while (i < n) {
      let j = i;
      while (j + 1 < n && this.blockOf[j + 1] === this.blockOf[i]) j++;
      if (j - i + 1 > this.maxRun) {
        let a = i;
        while (a <= j) {
          const kind = this.weekendFlag[a];
          let b = a;
          while (b + 1 <= j && this.weekendFlag[b + 1] === kind) b++;
          for (let c = a; c <= b; c++) this.blockOf[c] = a + Math.floor((c - a) / this.maxRun) * this.maxRun;
          a = b + 1;
        }
      }
      i = j + 1;
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
    let overRun = 0;
    let b2b = 0;
    const run = new Int32Array(nd);
    const lastWeekendWeek = new Int32Array(nd).fill(-10);
    const maxRun = this.maxRun;
    const tl = this.timeline;
    const limit = this.minRest;
    let monthly = 0;
    const until = this.checkpointUntil;
    for (let i = 0; i < tl.length; i++) {
      if (i > 0 && this.monthEnd[i - 1] && i - 1 <= until) {
        monthly += WEIGHTS.monthlyHoliday * this.spread(ho) + WEIGHTS.monthlyWeekend * this.spread(we) + WEIGHTS.monthlyTotal * this.spread(tot);
      }
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
      run[d] = gap === 1 ? run[d]! + 1 : 1;
      if (maxRun > 0 && run[d]! > maxRun) overRun += run[d]! - maxRun;
      if (this.avoidB2B && this.weekendFlag[i]) {
        const w = this.week[i]!;
        if (lastWeekendWeek[d] !== w) {
          if (lastWeekendWeek[d] === w - 1) b2b++;
          lastWeekendWeek[d] = w;
        }
      }
      last[d] = i;
      lastBlock[d] = this.blockOf[i]!;
    }
    if (this.monthEnd[tl.length - 1] && tl.length - 1 <= until) {
      monthly += WEIGHTS.monthlyHoliday * this.spread(ho) + WEIGHTS.monthlyWeekend * this.spread(we) + WEIGHTS.monthlyTotal * this.spread(tot);
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
      monthly +
      WEIGHTS.rest * rest +
      WEIGHTS.backToBack * b2b +
      WEIGHTS.overRun * overRun +
      WEIGHTS.off * off
    );
  }
}

interface Unit {
  idx: number[]; // indices dans la fenêtre
  allowed: number[]; // médecins possibles (absences exclues)
  priority: number; // 2 = contient un férié, 1 = week-end, 0 = semaine
}

/** Historique pris en compte pour l'équité : jusqu'à 24 mois avant la période. */
export const HISTORY_MONTHS = 24;

/**
 * Fenêtre d'équité : depuis la première astreinte connue (au plus 24 mois en
 * arrière, et au moins depuis le 1er janvier) jusqu'au 31 décembre de la fin
 * de période. Le passé n'est donc pas oublié au changement d'année.
 */
export function fairnessWindow(state: PlanState, from: ISODate, to: ISODate): { from: ISODate; to: ISODate } {
  const y = yearOf(from);
  const m = Number(from.slice(5, 7));
  const total = y * 12 + (m - 1) - HISTORY_MONTHS;
  const limit = `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}-01`;
  let start = `${y}-01-01`;
  for (const d of Object.keys(state.assignments)) if (d < start && d >= limit && d < from) start = d;
  return { from: start.slice(0, 8) + '01', to: `${yearOf(to)}-12-31` };
}

export function generate(state: PlanState, opts: GenerateOptions): GenerateResult {
  const { from, to } = opts;
  const replace = opts.replaceUnlocked ?? true;
  const win = fairnessWindow(state, from, to);

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
  ev.checkpointUntil = Math.max(ev.checkpointUntil, ev.index.get(to)!);
  const nd = ev.nd;
  const warnings: Warning[] = [];
  if (nd === 0) return { assignments: {}, warnings: [{ date: from, message: 'Aucun médecin dans l’équipe.' }], cost: 0 };

  // Disponibilité (absences = interdit ; jour non travaillé = autorisé mais très pénalisé).
  const absent = (k: number, d: ISODate) => unavailability(state, state.doctors[k]!.id, d)?.kind === 'absence';
  const offDay = (k: number, d: ISODate) => isOffDay(state, state.doctors[k]!, weekday(d));

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
    // Pas d'alerte pour le week-end : y être d'astreinte sans y travailler est normal.
    if (clean.length === 0 && !dates.every((d) => isOnCallWeekend(d, state.settings))) {
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
  warnings.push(...ruleWarnings(state, out, from, to));
  warnings.sort((a, b) => a.date.localeCompare(b.date));
  return { assignments: out, warnings, cost: bestCost };
}

/**
 * Ce que l'assistant n'a pas pu éviter : séries de jours au-delà du maximum,
 * week-ends d'affilée pour la même personne.
 */
export function ruleWarnings(
  state: PlanState,
  assignments: Record<ISODate, Assignment>,
  from: ISODate,
  to: ISODate,
): Warning[] {
  const out: Warning[] = [];
  const name = (id: string) => state.doctors.find((d) => d.id === id)?.name ?? '?';
  const max = state.settings.maxConsecutive | 0;
  const days = eachDay(addDays(from, -7), addDays(to, 7));

  if (max > 0) {
    let who: string | null = null;
    let start = '';
    let len = 0;
    const close = (end: ISODate) => {
      if (who && len > max && start <= to && end >= from) {
        out.push({ date: start, message: `${name(who)} : ${len} jours d’astreinte d’affilée (max ${max}).` });
      }
    };
    for (const d of days) {
      const doc = assignments[d]?.doctorId ?? null;
      if (doc && doc === who) {
        len++;
        continue;
      }
      close(addDays(d, -1));
      who = doc;
      start = d;
      len = doc ? 1 : 0;
    }
    close(days[days.length - 1]!);
  }

  if (state.settings.avoidBackToBackWeekends ?? true) {
    const weekendOf = (sunday: ISODate) => {
      const ids = new Set<string>();
      let first: ISODate | null = null;
      for (let k = 6; k >= 0; k--) {
        const d = addDays(sunday, -k);
        if (!isOnCallWeekend(d, state.settings)) continue;
        first ??= d;
        const a = assignments[d];
        if (a) ids.add(a.doctorId);
      }
      return { ids, first: first ?? sunday };
    };
    for (const d of days) {
      if (weekday(d) !== 6) continue;
      const cur = weekendOf(d);
      if (cur.first < from || cur.first > to) continue;
      const prev = weekendOf(addDays(d, -7));
      for (const id of cur.ids) {
        if (prev.ids.has(id)) out.push({ date: cur.first, message: `${name(id)} : deux week-ends d’affilée.` });
      }
    }
  }
  return out;
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
  const win = fairnessWindow(state, date, date);
  const without: PlanState = { ...state, assignments: { ...state.assignments } };
  delete without.assignments[date];
  const ev = new Evaluator(without, win.from, win.to);
  const i = ev.index.get(date)!;
  ev.checkpointUntil = Math.max(ev.checkpointUntil, i);
  const base = ev.cost();
  const minRest = state.settings.minRest;
  const res = state.doctors.map((doc, k): Suggestion => {
    const u = unavailability(state, doc.id, date);
    const notes: string[] = [];
    let blocked: string | null = null;
    if (u?.kind === 'absence') blocked = u.label;
    if (u?.kind === 'off') notes.push('Jour non travaillé');
    // Série de jours consécutifs si on lui confie ce jour.
    let run = 1;
    for (let j = i - 1; j >= 0 && ev.timeline[j] === k; j--) run++;
    for (let j = i + 1; j < ev.timeline.length && ev.timeline[j] === k; j++) run++;
    const max = state.settings.maxConsecutive | 0;
    if (max > 0 && run > max) notes.push(`${run} jours d’affilée (max ${max})`);
    if ((state.settings.avoidBackToBackWeekends ?? true) && ev.isWeekendIdx(i)) {
      for (const g of [-7, 7]) {
        let hit = false;
        for (let j = i + g - 3; j <= i + g + 3; j++) {
          if (j >= 0 && j < ev.timeline.length && ev.isWeekendIdx(j) && ev.timeline[j] === k && Math.abs(j - i) > 3) hit = true;
        }
        if (hit) {
          notes.push(g < 0 ? 'Déjà d’astreinte le week-end précédent' : 'D’astreinte le week-end suivant');
          break;
        }
      }
    }
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
