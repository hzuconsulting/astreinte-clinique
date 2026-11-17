import { eachDay, weekday, type ISODate } from './dates';
import { holidayIndex, isOnCallWeekend, type PlanState } from './model';

export interface DoctorStats {
  doctorId: string;
  total: number;
  weekend: number;
  holiday: number;
  byWeekday: number[];
  holidayDates: ISODate[];
}

export interface YearStats {
  year: number;
  rows: DoctorStats[];
  unassigned: number;
  days: number;
}

export function yearStats(state: PlanState, year: number, from?: ISODate, to?: ISODate): YearStats {
  const holidays = holidayIndex(state.settings, year, year);
  const rows = new Map<string, DoctorStats>(
    state.doctors.map((d) => [
      d.id,
      { doctorId: d.id, total: 0, weekend: 0, holiday: 0, byWeekday: [0, 0, 0, 0, 0, 0, 0], holidayDates: [] },
    ]),
  );
  let unassigned = 0;
  const days = eachDay(from ?? `${year}-01-01`, to ?? `${year}-12-31`);
  for (const d of days) {
    const a = state.assignments[d];
    const r = a ? rows.get(a.doctorId) : undefined;
    if (!r) {
      unassigned++;
      continue;
    }
    r.total++;
    if (isOnCallWeekend(d, state.settings)) r.weekend++;
    if (holidays.has(d)) {
      r.holiday++;
      r.holidayDates.push(d);
    }
    r.byWeekday[weekday(d)]!++;
  }
  return { year, rows: [...rows.values()], unassigned, days: days.length };
}

export interface Balance {
  doctorId: string;
  /** Écart à la part équitable : positif = a fait plus que sa part. */
  total: number;
  weekend: number;
  holiday: number;
}

/**
 * Solde de chacun : ce qu'il a fait au-delà (ou en deçà) de sa part équitable,
 * depuis le début de l'historique pris en compte par l'assistant (24 mois max).
 */
export function balances(state: PlanState, to: ISODate, historyMonths = 24): { from: ISODate; rows: Balance[] } {
  const y = Number(to.slice(0, 4));
  const m = Number(to.slice(5, 7));
  const t = y * 12 + (m - 1) - historyMonths + 1;
  const limit = `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}-01`;
  const dates = Object.keys(state.assignments).filter((d) => d >= limit && d <= to).sort();
  const from = dates[0] ?? to;
  const holidays = holidayIndex(state.settings, Number(from.slice(0, 4)), y);
  const counts = new Map(state.doctors.map((d) => [d.id, { total: 0, weekend: 0, holiday: 0 }]));
  for (const d of dates) {
    const c = counts.get(state.assignments[d]!.doctorId);
    if (!c) continue;
    c.total++;
    if (isOnCallWeekend(d, state.settings)) c.weekend++;
    if (holidays.has(d)) c.holiday++;
  }
  const shares = state.doctors.map((d) => Math.max(0.05, (d.share || 100) / 100));
  const sumShares = shares.reduce((a, b) => a + b, 0);
  const sum = (k: 'total' | 'weekend' | 'holiday') => [...counts.values()].reduce((a, c) => a + c[k], 0);
  const all = { total: sum('total'), weekend: sum('weekend'), holiday: sum('holiday') };
  const rows = state.doctors.map((d, k) => {
    const c = counts.get(d.id)!;
    const part = shares[k]! / sumShares;
    return {
      doctorId: d.id,
      total: c.total - all.total * part,
      weekend: c.weekend - all.weekend * part,
      holiday: c.holiday - all.holiday * part,
    };
  });
  return { from, rows };
}
