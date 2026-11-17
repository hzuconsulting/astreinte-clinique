/**
 * Synchronisation du planning entre les membres de l'équipe, via Supabase.
 *
 * Tout le planning est un seul document JSON, rangé sous un « code d'équipe »
 * secret. Chaque enregistrement porte la version connue ; s'il est refusé
 * parce qu'un collègue a enregistré entre-temps, on fusionne (fusion à trois :
 * dernière version commune, la mienne, la sienne) et on réessaie.
 */
import type { PlanState } from './model';
import { parseState } from './storage';

/**
 * Connexion à la base partagée. La clé « publishable » est faite pour être
 * publique (elle est de toute façon lisible dans le site) ; les variables
 * d'environnement permettent de pointer une autre base sans toucher au code.
 */
export interface SyncConfig {
  url: string;
  key: string;
  /** Identifiant de l'unique planning dans la table. */
  code: string;
}

export const SYNC: SyncConfig = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://rlyuswzqxgcmluhrnpyi.supabase.co',
  key: process.env.NEXT_PUBLIC_SUPABASE_KEY || 'sb_publishable_IX6xvz-yQdzWHZxeBwxr3A_WoSb2iTH',
  code: process.env.NEXT_PUBLIC_PLANNING_ID || 'astreinte-clinique-planning',
};

export interface Remote {
  state: PlanState;
  version: number;
}

function normalizeUrl(url: string): string {
  const u = url.trim().replace(/\/+$/, '');
  return /^https?:\/\//.test(u) ? u : `https://${u}`;
}

export class SyncError extends Error {}

type Fetch = typeof fetch;

async function rpc<T>(c: SyncConfig, fn: string, body: unknown, f: Fetch = fetch): Promise<T> {
  const headers: Record<string, string> = { apikey: c.key, 'Content-Type': 'application/json' };
  // Les anciennes clés « anon » sont des JWT ; les nouvelles clés publiables passent par `apikey` seul.
  if (c.key.startsWith('eyJ')) headers.Authorization = `Bearer ${c.key}`;
  let res: Response;
  try {
    res = await f(`${normalizeUrl(c.url)}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(body) });
  } catch {
    throw new SyncError('Connexion impossible (hors ligne ?)');
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    if (res.status === 404 || /get_plan|save_plan|function/i.test(txt)) {
      throw new SyncError('Base non préparée : exécute le script SQL dans Supabase.');
    }
    if (res.status === 401 || res.status === 403) throw new SyncError('Clé Supabase refusée.');
    throw new SyncError(`Erreur du serveur (${res.status})`);
  }
  return (await res.json()) as T;
}

export async function fetchRemote(c: SyncConfig, f?: Fetch): Promise<Remote | null> {
  const rows = await rpc<{ plan: unknown; plan_version: number }[]>(c, 'get_plan', { p_code: c.code }, f);
  const row = rows[0];
  if (!row) return null;
  const state = parseState(row.plan);
  if (!state) throw new SyncError('Données en ligne illisibles.');
  return { state, version: row.plan_version };
}

export async function pushRemote(
  c: SyncConfig,
  state: PlanState,
  version: number,
  f?: Fetch,
): Promise<{ ok: true; version: number } | { ok: false; remote: Remote }> {
  const rows = await rpc<{ ok: boolean; plan_version: number; plan: unknown }[]>(
    c,
    'save_plan',
    { p_code: c.code, p_data: state, p_version: version },
    f,
  );
  const row = rows[0];
  if (!row) throw new SyncError('Réponse vide du serveur.');
  if (row.ok) return { ok: true, version: row.plan_version };
  const remote = parseState(row.plan);
  if (!remote) throw new SyncError('Données en ligne illisibles.');
  return { ok: false, remote: { state: remote, version: row.plan_version } };
}

// ——— Fusion à trois ———————————————————————————————————————————————

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Pour chaque clé : si je l'ai changée depuis la base, ma valeur gagne ; sinon celle du collègue. */
function mergeRecord<T>(base: Record<string, T>, mine: Record<string, T>, theirs: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = { ...theirs };
  for (const k of new Set([...Object.keys(base), ...Object.keys(mine)])) {
    if (same(base[k], mine[k])) continue;
    if (mine[k] === undefined) delete out[k];
    else out[k] = mine[k]!;
  }
  return out;
}

function mergeById<T extends { id: string }>(base: T[], mine: T[], theirs: T[]): T[] {
  const byId = (xs: T[]) => Object.fromEntries(xs.map((x) => [x.id, x]));
  const merged = mergeRecord(byId(base), byId(mine), byId(theirs));
  const order = [...theirs.map((x) => x.id), ...mine.map((x) => x.id)];
  return [...new Set(order)].filter((id) => merged[id]).map((id) => merged[id]!);
}

export function merge3(base: PlanState, mine: PlanState, theirs: PlanState): PlanState {
  return {
    version: 1,
    doctors: mergeById(base.doctors, mine.doctors, theirs.doctors),
    absences: mergeById(base.absences, mine.absences, theirs.absences),
    assignments: mergeRecord(base.assignments, mine.assignments, theirs.assignments),
    settings: mergeRecord(
      base.settings as unknown as Record<string, unknown>,
      mine.settings as unknown as Record<string, unknown>,
      theirs.settings as unknown as Record<string, unknown>,
    ) as unknown as PlanState['settings'],
  };
}
