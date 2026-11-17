import { addDays, type ISODate } from './dates';
import type { PlanState } from './model';

/** Fichier .ics des astreintes d'un médecin, pour l'ajouter à son agenda. */
export function buildIcs(state: PlanState, doctorId: string, from: ISODate, to: ISODate): string {
  const doc = state.doctors.find((d) => d.id === doctorId);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//astreinte-clinique//FR',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:Astreintes ${doc?.name ?? ''}`,
  ];
  const dates = Object.keys(state.assignments)
    .filter((d) => d >= from && d <= to && state.assignments[d]!.doctorId === doctorId)
    .sort();
  // Les jours consécutifs (un week-end) deviennent un seul événement.
  let i = 0;
  while (i < dates.length) {
    const start = dates[i]!;
    let end = start;
    while (dates[i + 1] === addDays(end, 1)) end = dates[++i]!;
    i++;
    lines.push(
      'BEGIN:VEVENT',
      `UID:astreinte-${doctorId}-${start}@astreinte-clinique`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${start.replace(/-/g, '')}`,
      `DTEND;VALUE=DATE:${addDays(end, 1).replace(/-/g, '')}`,
      'SUMMARY:Astreinte clinique',
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
