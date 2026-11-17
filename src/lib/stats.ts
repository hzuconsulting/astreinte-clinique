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
