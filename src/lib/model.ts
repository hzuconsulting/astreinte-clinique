import { isWeekend, toDate, weekday, type ISODate, type Weekday } from './dates';
import { frenchHolidays } from './holidays';

export interface Doctor {
  id: string;
  name: string;
  color: string;
  /**
   * Jours de la semaine non travaillés, de façon récurrente (0 = lundi).
   * Le médecin n'est jamais mis d'astreinte ces jours-là.
   */
  offWeekdays: Weekday[];
  /** Part de la charge, en % (100 = temps plein). Les cibles d'équité en tiennent compte. */
  share: number;
}

export interface Absence {
  id: string;
  doctorId: string;
  start: ISODate;
  end: ISODate;
  label: string;
}

export interface Assignment {
  doctorId: string;
  /** Choix manuel : le générateur n'y touche jamais. */
  locked: boolean;
}

export interface Settings {
  /** Un même médecin prend tout le week-end, pont férié compris. */
  groupWeekends: boolean;
  /** Repos souhaité entre deux astreintes (en jours), hors bloc week-end. */
  minRest: number;
  alsaceMoselle: boolean;
  customHolidays: { date: ISODate; name: string }[];
}

export interface PlanState {
  version: 1;
  doctors: Doctor[];
  absences: Absence[];
  assignments: Record<ISODate, Assignment>;
  settings: Settings;
}

export const DOCTOR_COLORS = ['#0F766E', '#7C3AED', '#C2410C', '#2563EB', '#BE185D', '#4D7C0F'];

export function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function defaultState(): PlanState {
  return {
    version: 1,
    doctors: [
      { id: uid(), name: 'Dr A', color: DOCTOR_COLORS[0]!, offWeekdays: [], share: 100 },
      { id: uid(), name: 'Dr B', color: DOCTOR_COLORS[1]!, offWeekdays: [], share: 100 },
      { id: uid(), name: 'Dr C', color: DOCTOR_COLORS[2]!, offWeekdays: [], share: 100 },
    ],
    absences: [],
    assignments: {},
    settings: { groupWeekends: true, minRest: 1, alsaceMoselle: false, customHolidays: [] },
  };
}

/** Index des jours fériés (nationaux + ajoutés) pour une plage d'années. */
export function holidayIndex(settings: Settings, fromYear: number, toYear: number): Map<ISODate, string> {
  const map = new Map<ISODate, string>();
  for (let y = fromYear; y <= toYear; y++) {
    for (const h of frenchHolidays(y, settings.alsaceMoselle)) map.set(h.date, h.name);
  }
  for (const h of settings.customHolidays) map.set(h.date, h.name);
  return map;
}

export type Unavailability = { kind: 'absence'; label: string } | { kind: 'off'; weekday: Weekday };

/** Pourquoi un médecin ne peut pas être d'astreinte ce jour-là (null = disponible). */
export function unavailability(state: PlanState, doctorId: string, date: ISODate): Unavailability | null {
  for (const a of state.absences) {
    if (a.doctorId === doctorId && a.start <= date && date <= a.end) {
      return { kind: 'absence', label: a.label || 'Absence' };
    }
  }
  const doc = state.doctors.find((d) => d.id === doctorId);
  const wd = weekday(date);
  if (doc?.offWeekdays.includes(wd)) return { kind: 'off', weekday: wd };
  return null;
}

export interface DayInfo {
  date: ISODate;
  weekend: boolean;
  holiday: string | null;
}

export function dayInfo(date: ISODate, holidays: Map<ISODate, string>): DayInfo {
  return { date, weekend: isWeekend(date), holiday: holidays.get(date) ?? null };
}

export function yearOf(date: ISODate): number {
  return toDate(date).getUTCFullYear();
}
