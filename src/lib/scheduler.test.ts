import { describe, expect, it } from 'vitest';
import { addDays, eachDay, isWeekend, weekday } from './dates';
import { easterSunday, frenchHolidays } from './holidays';
import { defaultState, type PlanState } from './model';
import { generate, suggest } from './scheduler';
import { yearStats } from './stats';
import { decodeShare, encodeShare } from './storage';
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
    expect(spread((r) => r.weekend)).toBeLessThanOrEqual(2); // un week-end = 2 jours
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

  it('donne le week-end entier à la même personne', () => {
    const s = team();
    const r = generate(s, { from: '2027-03-01', to: '2027-03-31', seed: 4 });
    for (const d of eachDay('2027-03-01', '2027-03-31')) {
      if (weekday(d) === 5 && d < '2027-03-31') expect(r.assignments[addDays(d, 1)]!.doctorId).toBe(r.assignments[d]!.doctorId);
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

describe('partage', () => {
  it('encode et décode un planning complet', async () => {
    const s = team();
    s.assignments = generate(s, { from: '2027-01-01', to: '2027-12-31', seed: 1, restarts: 1 }).assignments;
    const code = await encodeShare(s);
    expect(code.length).toBeLessThan(12_000);
    expect(await decodeShare(code)).toEqual(s);
  });

  it('exporte un agenda .ics avec un événement par bloc', () => {
    const s = team();
    s.assignments = { '2027-01-02': { doctorId: 'd0', locked: false }, '2027-01-03': { doctorId: 'd0', locked: false } };
    const ics = buildIcs(s, 'd0', '2027-01-01', '2027-12-31');
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics).toContain('DTEND;VALUE=DATE:20270104');
    expect(isWeekend('2027-01-02')).toBe(true);
  });
});
