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

function toB64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64Url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

/** Tout le planning, compressé, tient dans le fragment `#p=…` d'une URL. */
export async function encodeShare(state: PlanState): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(state));
  return toB64Url(await pipe(json, new CompressionStream('deflate-raw')));
}

export async function decodeShare(code: string): Promise<PlanState | null> {
  try {
    const bytes = await pipe(fromB64Url(code), new DecompressionStream('deflate-raw'));
    return parseState(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}
