import { describe, expect, it } from 'vitest';
import { addDays, eachDay, weekday } from './dates';
import { easterSunday, frenchHolidays } from './holidays';
import { defaultState, type PlanState } from './model';
import { generate, suggest } from './scheduler';
import { yearStats } from './stats';
import { buildIcs } from './ics';

function team(): PlanState {
  const s = defaultState();
  s.doctors = s.doctors.map((d, k) => ({ ...d, id: `d${k}`, name: `Dr ${'ABC'[k]}` }));
  return s;
}

describe('jours fériés', () => {
  it('calcule Pâques', () => {
    expect(easterSunday(2025)).toBe('2025-04-20');
    expect(easterSunday(2026)).toBe('2026-04-05');
    expect(easterSunday(2027)).toBe('2027-03-28');
  });
  it('liste les 11 fériés nationaux, 13 en Alsace-Moselle', () => {
    const h = frenchHolidays(2026);
    expect(h).toHaveLength(11);
    expect(h.map((x) => x.date)).toContain('2026-05-14'); // Ascension
    expect(h.map((x) => x.date)).toContain('2026-05-25'); // Pentecôte
    expect(frenchHolidays(2026, true)).toHaveLength(13);
  });
});

describe('générateur', () => {
  it('couvre chaque jour de l’année avec exactement un médecin', () => {
    const s = team();
    const r = generate(s, { from: '2027-01-01', to: '2027-12-31', seed: 3 });
    expect(r.warnings).toEqual([]);
    for (const d of eachDay('2027-01-01', '2027-12-31')) expect(r.assignments[d]).toBeDefined();
  });

  it('répartit équitablement fériés, week-ends et total', () => {
    const s = team();
    s.assignments = generate(s, { from: '2027-01-01', to: '2027-12-31', seed: 5 }).assignments;
    const st = yearStats(s, 2027);
    const spread = (f: (r: (typeof st.rows)[number]) => number) =>
      Math.max(...st.rows.map(f)) - Math.min(...st.rows.map(f));
    expect(spread((r) => r.holiday)).toBeLessThanOrEqual(1);
    expect(spread((r) => r.weekend)).toBeLessThanOrEqual(3); // un week-end = 3 jours
    expect(spread((r) => r.total)).toBeLessThanOrEqual(2);
  });

  it('ne met jamais un absent d’astreinte', () => {
    const s = team();
    s.absences = [{ id: 'a', doctorId: 'd0', start: '2027-07-01', end: '2027-07-31', label: 'Vacances' }];
    const r = generate(s, { from: '2027-06-01', to: '2027-08-31', seed: 1 });
    for (const d of eachDay('2027-07-01', '2027-07-31')) expect(r.assignments[d]!.doctorId).not.toBe('d0');
  });

  it('respecte les jours non travaillés récurrents', () => {
    const s = team();
    s.doctors[1]!.offWeekdays = [0]; // Dr B ne travaille pas le lundi
    s.doctors[2]!.offWeekdays = [2, 4]; // Dr C : ni mercredi ni vendredi
    const r = generate(s, { from: '2027-01-01', to: '2027-06-30', seed: 2 });
    for (const [d, a] of Object.entries(r.assignments)) {
      if (a.doctorId === 'd1') expect(weekday(d)).not.toBe(0);
      if (a.doctorId === 'd2') expect([2, 4]).not.toContain(weekday(d));
    }
  });

  it('donne le week-end entier (vendredi → dimanche) à la même personne', () => {
    const s = team();
    const r = generate(s, { from: '2027-03-01', to: '2027-03-31', seed: 4 });
    for (const d of eachDay('2027-03-01', '2027-03-28')) {
      if (weekday(d) === 4) {
        expect(r.assignments[addDays(d, 1)]!.doctorId).toBe(r.assignments[d]!.doctorId);
        expect(r.assignments[addDays(d, 2)]!.doctorId).toBe(r.assignments[d]!.doctorId);
      }
    }
    // Le vendredi compte comme un jour de week-end.
    const st = yearStats({ ...s, assignments: r.assignments }, 2027, '2027-03-01', '2027-03-31');
    expect(st.rows.reduce((n, x) => n + x.weekend, 0)).toBe(12); // 4 week-ends × 3 jours
  });

  it('accole le férié au week-end (lundi de Pâques → ven.-lun.)', () => {
    const s = team();
    const r = generate(s, { from: '2027-03-22', to: '2027-04-04', seed: 2 });
    const who = r.assignments['2027-03-26']!.doctorId; // vendredi avant Pâques 2027
    for (const d of ['2027-03-27', '2027-03-28', '2027-03-29']) expect(r.assignments[d]!.doctorId).toBe(who);
  });

  it('garde le réglage samedi → dimanche', () => {
    const s = team();
    s.settings.weekendStart = 5;
    const r = generate(s, { from: '2027-03-01', to: '2027-03-31', seed: 4 });
    const st = yearStats({ ...s, assignments: r.assignments }, 2027, '2027-03-01', '2027-03-31');
    expect(st.rows.reduce((n, x) => n + x.weekend, 0)).toBe(8);
    for (const d of eachDay('2027-03-01', '2027-03-28')) {
      if (weekday(d) === 5) expect(r.assignments[addDays(d, 1)]!.doctorId).toBe(r.assignments[d]!.doctorId);
    }
  });

  it('ne touche pas aux jours verrouillés', () => {
    const s = team();
    s.assignments['2027-02-10'] = { doctorId: 'd2', locked: true };
    s.assignments['2027-02-11'] = { doctorId: 'd2', locked: true };
    const r = generate(s, { from: '2027-02-01', to: '2027-02-28', seed: 9 });
    expect(r.assignments['2027-02-10']).toEqual({ doctorId: 'd2', locked: true });
    expect(r.assignments['2027-02-11']).toEqual({ doctorId: 'd2', locked: true });
  });

  it('tient compte de l’historique de l’année', () => {
    const s = team();
    // Dr A a déjà fait tout le premier trimestre.
    for (const d of eachDay('2027-01-01', '2027-03-31')) s.assignments[d] = { doctorId: 'd0', locked: true };
    const r = generate(s, { from: '2027-04-01', to: '2027-12-31', seed: 1 });
    const st = yearStats({ ...s, assignments: r.assignments }, 2027);
    const a = st.rows.find((x) => x.doctorId === 'd0')!;
    const b = st.rows.find((x) => x.doctorId === 'd1')!;
    expect(Math.abs(a.total - b.total)).toBeLessThanOrEqual(3);
  });

  it('signale un jour où tout le monde est absent', () => {
    const s = team();
    s.absences = s.doctors.map((d) => ({ id: d.id, doctorId: d.id, start: '2027-08-15', end: '2027-08-15', label: '' }));
    const r = generate(s, { from: '2027-08-01', to: '2027-08-31', seed: 1 });
    expect(r.assignments['2027-08-15']).toBeUndefined();
    expect(r.warnings.map((w) => w.date)).toContain('2027-08-15');
  });

  it('suggère d’abord le médecin le moins chargé et bloque les absents', () => {
    const s = team();
    s.absences = [{ id: 'a', doctorId: 'd2', start: '2027-05-03', end: '2027-05-03', label: 'Congrès' }];
    s.assignments['2027-05-01'] = { doctorId: 'd0', locked: true };
    const sug = suggest(s, '2027-05-03');
    expect(sug[sug.length - 1]!.doctorId).toBe('d2');
    expect(sug[sug.length - 1]!.blocked).toBe('Congrès');
  });
});

describe('agenda', () => {
  it('exporte un agenda .ics avec un événement par bloc', () => {
    const s = team();
    s.assignments = { '2027-01-02': { doctorId: 'd0', locked: false }, '2027-01-03': { doctorId: 'd0', locked: false } };
    const ics = buildIcs(s, 'd0', '2027-01-01', '2027-12-31');
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics).toContain('DTEND;VALUE=DATE:20270104');
  });
});

describe('week-ends non travaillés', () => {
  it('garde le week-end groupé et sans alerte quand personne ne travaille le samedi-dimanche', () => {
    const s = team();
    s.doctors.forEach((d) => (d.offWeekdays = [5, 6]));
    const r = generate(s, { from: '2027-03-01', to: '2027-03-31', seed: 1 });
    expect(r.warnings).toEqual([]);
    for (const d of eachDay('2027-03-01', '2027-03-28')) {
      if (weekday(d) === 4) expect(r.assignments[addDays(d, 2)]!.doctorId).toBe(r.assignments[d]!.doctorId);
    }
  });

  it('pas d’alerte un week-end où seuls des non-travaillants sont présents', () => {
    const s = team();
    s.doctors[0]!.offWeekdays = [5, 6];
    s.doctors[1]!.offWeekdays = [5, 6];
    s.absences = [{ id: 'a', doctorId: 'd2', start: '2027-03-01', end: '2027-03-31', label: '' }];
    const r = generate(s, { from: '2027-03-01', to: '2027-03-31', seed: 1 });
    expect(r.warnings.filter((w) => weekday(w.date) >= 5)).toEqual([]);
    expect(r.assignments['2027-03-06']).toBeDefined();
  });
});

describe('week-ends d’affilée et jours consécutifs', () => {
  const weekendOwners = (r: ReturnType<typeof generate>, from: string, to: string) =>
    eachDay(from, to).filter((d) => weekday(d) === 5).map((d) => r.assignments[d]!.doctorId);

  it('évite deux week-ends d’affilée à la même personne', () => {
    const s = team();
    const r = generate(s, { from: '2027-01-01', to: '2027-12-31', seed: 3 });
    const owners = weekendOwners(r, '2027-01-01', '2027-12-31');
    const repeats = owners.filter((o, k) => k > 0 && o === owners[k - 1]).length;
    expect(repeats).toBe(0);
    expect(r.warnings.filter((w) => w.message.includes('week-ends'))).toEqual([]);
  });

  it('signale les week-ends d’affilée inévitables', () => {
    const s = team();
    // Deux médecins absents trois semaines : le troisième enchaîne forcément.
    s.absences = [
      { id: 'a', doctorId: 'd0', start: '2027-07-01', end: '2027-07-25', label: '' },
      { id: 'b', doctorId: 'd1', start: '2027-07-01', end: '2027-07-25', label: '' },
    ];
    const r = generate(s, { from: '2027-07-01', to: '2027-07-31', seed: 1 });
    expect(r.warnings.some((w) => w.message.includes('deux week-ends'))).toBe(true);
  });

  it('respecte le maximum de jours consécutifs, week-end compris', () => {
    const s = team();
    s.settings.maxConsecutive = 3;
    const r = generate(s, { from: '2027-01-01', to: '2027-12-31', seed: 2 });
    let run = 0;
    let prev = '';
    for (const d of eachDay('2027-01-01', '2027-12-31')) {
      const who = r.assignments[d]!.doctorId;
      run = who === prev ? run + 1 : 1;
      prev = who;
      expect(run).toBeLessThanOrEqual(3);
    }
    // Pâques 2027 : ven. 26 → lun. 29 mars, 4 jours > 3 → le lundi revient à quelqu'un d'autre.
    expect(r.assignments['2027-03-29']!.doctorId).not.toBe(r.assignments['2027-03-28']!.doctorId);
    expect(r.assignments['2027-03-28']!.doctorId).toBe(r.assignments['2027-03-26']!.doctorId);
  });

  it('avec un maximum de 1, jamais deux jours de suite', () => {
    const s = team();
    s.settings.maxConsecutive = 1;
    const r = generate(s, { from: '2027-03-01', to: '2027-04-30', seed: 5 });
    for (const d of eachDay('2027-03-02', '2027-04-30')) {
      expect(r.assignments[d]!.doctorId).not.toBe(r.assignments[addDays(d, -1)]!.doctorId);
    }
  });
});

describe('rattrapage des déséquilibres', () => {
  const weekendDays = (a: Record<string, { doctorId: string }>, id: string, from: string, to: string) =>
    eachDay(from, to).filter((d) => weekday(d) >= 4 && a[d]?.doctorId === id).length;

  it('compense en janvier un mois de décembre déséquilibré (changement d’année)', () => {
    const s = team();
    // Décembre 2026 imposé : Dr A a 3 week-ends sur 4, Dr B un seul, Dr C aucun.
    const owner: Record<number, string> = { 4: 'd0', 11: 'd0', 18: 'd0', 25: 'd1' };
    for (const d of eachDay('2026-12-01', '2026-12-31')) {
      const fri = Number(addDays(d, -((weekday(d) + 3) % 7)).slice(8));
      const isWe = weekday(d) >= 4;
      s.assignments[d] = { doctorId: isWe ? (owner[fri] ?? 'd1') : ['d1', 'd2', 'd2'][Number(d.slice(8)) % 3]!, locked: true };
    }
    const r = generate(s, { from: '2027-01-01', to: '2027-01-31', seed: 1 });
    const a = weekendDays(r.assignments, 'd0', '2027-01-01', '2027-01-31');
    const c = weekendDays(r.assignments, 'd2', '2027-01-01', '2027-01-31');
    expect(a).toBe(0); // Dr A n'a aucun week-end en janvier
    expect(c).toBeGreaterThanOrEqual(6); // Dr C rattrape
  });

  it('rattrape dès le mois suivant après une absence', () => {
    const s = team();
    s.absences = [{ id: 'a', doctorId: 'd0', start: '2027-03-01', end: '2027-03-31', label: 'Vacances' }];
    const r = generate(s, { from: '2027-01-01', to: '2027-12-31', seed: 4 });
    const st = (to: string) =>
      ['d0', 'd1', 'd2'].map((id) => weekendDays(r.assignments, id, '2027-01-01', to));
    const endApril = st('2027-04-30');
    const endMay = st('2027-05-31');
    // Fin mars, Dr A a un retard d'au moins 4 week-ends ; fin mai, il est rattrapé à un week-end près.
    expect(Math.max(...endMay) - Math.min(...endMay)).toBeLessThanOrEqual(3);
    expect(endApril[0]).toBeGreaterThan(0);
  });
});

describe('solde', () => {
  it('mesure l’écart à la part équitable', async () => {
    const { balances } = await import('./stats');
    const s = team();
    // 6 jours : A en a 4, B 2, C 0 → part = 2 chacun.
    ['2027-01-04', '2027-01-05', '2027-01-06', '2027-01-07'].forEach((d) => (s.assignments[d] = { doctorId: 'd0', locked: false }));
    ['2027-01-11', '2027-01-12'].forEach((d) => (s.assignments[d] = { doctorId: 'd1', locked: false }));
    const b = balances(s, '2027-01-31');
    expect(b.rows.map((r) => Math.round(r.total))).toEqual([2, 0, -2]);
    expect(b.from).toBe('2027-01-04');
  });
});
