import { addDays, ymd, type ISODate } from './dates';

/** Dimanche de Pâques (algorithme grégorien anonyme, Meeus/Jones/Butcher). */
export function easterSunday(year: number): ISODate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return ymd(year, month, day);
}

export interface Holiday {
  date: ISODate;
  name: string;
}

/** Les 11 jours fériés nationaux, plus les 2 d'Alsace-Moselle si demandé. */
export function frenchHolidays(year: number, alsaceMoselle = false): Holiday[] {
  const easter = easterSunday(year);
  const list: Holiday[] = [
    { date: ymd(year, 1, 1), name: "Jour de l'an" },
    { date: addDays(easter, 1), name: 'Lundi de Pâques' },
    { date: ymd(year, 5, 1), name: 'Fête du Travail' },
    { date: ymd(year, 5, 8), name: 'Victoire 1945' },
    { date: addDays(easter, 39), name: 'Ascension' },
    { date: addDays(easter, 50), name: 'Lundi de Pentecôte' },
    { date: ymd(year, 7, 14), name: 'Fête nationale' },
    { date: ymd(year, 8, 15), name: 'Assomption' },
    { date: ymd(year, 11, 1), name: 'Toussaint' },
    { date: ymd(year, 11, 11), name: 'Armistice 1918' },
    { date: ymd(year, 12, 25), name: 'Noël' },
  ];
  if (alsaceMoselle) {
    list.push({ date: addDays(easter, -2), name: 'Vendredi saint' });
    list.push({ date: ymd(year, 12, 26), name: 'Saint-Étienne' });
  }
  return list.sort((x, y) => x.date.localeCompare(y.date));
}
