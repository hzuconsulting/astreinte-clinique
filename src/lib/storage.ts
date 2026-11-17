import { defaultState, type PlanState } from './model';

const KEY = 'astreinte-clinique:v1';

/** Valide grossièrement un état importé (fichier, lien) avant de l'adopter. */
export function parseState(raw: unknown): PlanState | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Partial<PlanState>;
  if (s.version !== 1 || !Array.isArray(s.doctors) || !Array.isArray(s.absences) || typeof s.assignments !== 'object') {
    return null;
  }
  const def = defaultState();
  return {
    version: 1,
    doctors: s.doctors.map((d) => ({ ...d, offWeekdays: d.offWeekdays ?? [], share: d.share ?? 100 })),
    absences: s.absences,
    assignments: s.assignments ?? {},
    settings: { ...def.settings, ...(s.settings ?? {}) },
  };
}

export function loadLocal(): PlanState | null {
  try {
    const txt = localStorage.getItem(KEY);
    return txt ? parseState(JSON.parse(txt)) : null;
  } catch {
    return null;
  }
}

export function saveLocal(state: PlanState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* stockage plein ou interdit : l'appli reste utilisable en mémoire */
  }
}
