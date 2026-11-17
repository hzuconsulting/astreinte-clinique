/**
 * Dates « civiles » sans fuseau : une astreinte tombe un jour du calendrier,
 * pas à une heure UTC. Tout passe par des chaînes `AAAA-MM-JJ` et des Date en
 * UTC minuit, ce qui évite les décalages d'un jour au passage à l'heure d'été.
 */
export type ISODate = string;

/** 0 = lundi … 6 = dimanche (ordre du calendrier français). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const WEEKDAY_SHORT = ['L', 'M', 'M', 'J', 'V', 'S', 'D'] as const;
export const WEEKDAY_LABEL = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'] as const;
export const WEEKDAY_ABBR = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'] as const;
export const MONTH_LABEL = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
] as const;

export function toDate(iso: ISODate): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}

export function toISO(d: Date): ISODate {
  return d.toISOString().slice(0, 10);
}

export function ymd(y: number, m: number, d: number): ISODate {
  return toISO(new Date(Date.UTC(y, m - 1, d)));
}

export function addDays(iso: ISODate, n: number): ISODate {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return toISO(d);
}

export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86_400_000);
}

export function weekday(iso: ISODate): Weekday {
  return ((toDate(iso).getUTCDay() + 6) % 7) as Weekday;
}

export function isWeekend(iso: ISODate): boolean {
  return weekday(iso) >= 5;
}

/** Tous les jours de `from` à `to` inclus. */
export function eachDay(from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function monthBounds(year: number, month: number): { from: ISODate; to: ISODate } {
  const from = ymd(year, month, 1);
  const to = addDays(ymd(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1, 1), -1);
  return { from, to };
}

export function todayISO(): ISODate {
  const n = new Date();
  return ymd(n.getFullYear(), n.getMonth() + 1, n.getDate());
}

export function formatLong(iso: ISODate): string {
  const d = toDate(iso);
  return `${WEEKDAY_LABEL[weekday(iso)]} ${d.getUTCDate()} ${MONTH_LABEL[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export const MONTH_ABBR = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'] as const;

export function formatShort(iso: ISODate): string {
  const d = toDate(iso);
  return `${WEEKDAY_ABBR[weekday(iso)]} ${d.getUTCDate()} ${MONTH_ABBR[d.getUTCMonth()]}`;
}
