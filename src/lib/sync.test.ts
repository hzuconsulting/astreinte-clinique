import { describe, expect, it } from 'vitest';
import { defaultState, type PlanState } from './model';
import { decodeInvite, encodeInvite, merge3 } from './sync';

function base(): PlanState {
  const s = defaultState();
  s.doctors = s.doctors.map((d, k) => ({ ...d, id: `d${k}` }));
  s.assignments = { '2027-01-01': { doctorId: 'd0', locked: false } };
  return s;
}
const clone = (s: PlanState): PlanState => JSON.parse(JSON.stringify(s));

describe('fusion des modifications simultanées', () => {
  it('garde les changements des deux côtés quand ils ne se chevauchent pas', () => {
    const b = base();
    const mine = clone(b);
    mine.absences.push({ id: 'a1', doctorId: 'd0', start: '2027-02-01', end: '2027-02-07', label: 'Vacances' });
    mine.doctors[0]!.offWeekdays = [0];
    const theirs = clone(b);
    theirs.absences.push({ id: 'a2', doctorId: 'd1', start: '2027-03-01', end: '2027-03-02', label: 'Congrès' });
    theirs.assignments['2027-01-02'] = { doctorId: 'd2', locked: true };
    theirs.settings.minRest = 2;
    const m = merge3(b, mine, theirs);
    expect(m.absences.map((a) => a.id).sort()).toEqual(['a1', 'a2']);
    expect(m.doctors[0]!.offWeekdays).toEqual([0]);
    expect(m.assignments['2027-01-02']).toEqual({ doctorId: 'd2', locked: true });
    expect(m.assignments['2027-01-01']).toEqual({ doctorId: 'd0', locked: false });
    expect(m.settings.minRest).toBe(2);
  });

  it('applique les suppressions faites de mon côté', () => {
    const b = base();
    b.absences.push({ id: 'a1', doctorId: 'd0', start: '2027-02-01', end: '2027-02-07', label: 'Vacances' });
    const mine = clone(b);
    mine.absences = [];
    delete mine.assignments['2027-01-01'];
    const theirs = clone(b);
    theirs.doctors[1]!.name = 'Dr Bernard';
    const m = merge3(b, mine, theirs);
    expect(m.absences).toEqual([]);
    expect(m.assignments['2027-01-01']).toBeUndefined();
    expect(m.doctors[1]!.name).toBe('Dr Bernard');
  });

  it('sur le même jour, ma modification gagne', () => {
    const b = base();
    const mine = clone(b);
    mine.assignments['2027-01-01'] = { doctorId: 'd1', locked: true };
    const theirs = clone(b);
    theirs.assignments['2027-01-01'] = { doctorId: 'd2', locked: true };
    expect(merge3(b, mine, theirs).assignments['2027-01-01']!.doctorId).toBe('d1');
  });

  it('encode et décode le lien d’invitation', () => {
    const c = { url: 'https://abc.supabase.co', key: 'sb_publishable_xyz', code: 'AbC-123_xyzxyzxyzxyz' };
    expect(decodeInvite(encodeInvite(c))).toEqual(c);
  });
});
