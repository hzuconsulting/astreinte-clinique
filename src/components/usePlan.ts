'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { defaultState, type PlanState } from '@/lib/model';
import { loadLocal, saveLocal } from '@/lib/storage';
import { fetchRemote, merge3, pushRemote, SYNC, SyncError } from '@/lib/sync';

/**
 * Il n'existe qu'un planning : celui de la base en ligne. Tout le monde lit et
 * écrit le même.
 *
 * L'appareil en garde une copie, pour s'afficher immédiatement et pour qu'une
 * modification faite sans réseau parte dès qu'il revient. Chaque modification
 * est envoyée après une courte pause ; les modifications des autres arrivent
 * toutes les 10 s et au retour sur l'appli. Si deux personnes enregistrent en
 * même temps, les deux modifications sont fusionnées.
 */
export type SyncStatus =
  | { phase: 'loading' }
  | { phase: 'syncing'; lastSync?: number }
  | { phase: 'ok'; lastSync: number }
  | { phase: 'error'; error: string; lastSync?: number };

const META_KEY = 'astreinte-clinique:shared-meta';
const POLL_MS = 10_000;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** L'équipe d'exemple, jamais modifiée. */
function isPristine(s: PlanState): boolean {
  return (
    Object.keys(s.assignments).length === 0 &&
    s.absences.length === 0 &&
    s.doctors.every((d, k) => d.name === `Dr ${'ABC'[k]}` && d.offWeekdays.length === 0)
  );
}

/** Dernière version reçue de la base : sert à repérer ce qui n'a pas encore été envoyé. */
function loadMeta(): { version: number; base: PlanState } | null {
  try {
    return JSON.parse(localStorage.getItem(META_KEY) ?? 'null');
  } catch {
    return null;
  }
}
function saveMeta(version: number, base: PlanState) {
  try {
    localStorage.setItem(META_KEY, JSON.stringify({ version, base }));
  } catch {
    /* ignoré */
  }
}

export function usePlan() {
  const [state, setState] = useState<PlanState | null>(null);
  const [sync, setSync] = useState<SyncStatus>({ phase: 'loading' });

  const stateRef = useRef<PlanState | null>(null);
  const baseRef = useRef<PlanState | null>(null);
  const versionRef = useRef(0);
  const busyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSyncRef = useRef<number | undefined>(undefined);

  const commit = useCallback((s: PlanState) => {
    stateRef.current = s;
    setState(s);
  }, []);

  const synced = useCallback((version: number, base: PlanState) => {
    versionRef.current = version;
    baseRef.current = base;
    saveMeta(version, base);
    lastSyncRef.current = Date.now();
    setSync({ phase: 'ok', lastSync: lastSyncRef.current });
  }, []);

  const fail = useCallback((e: unknown) => {
    setSync({
      phase: 'error',
      error: e instanceof SyncError ? e.message : 'Erreur de synchronisation',
      lastSync: lastSyncRef.current,
    });
  }, []);

  /** Envoie l'état courant ; si quelqu'un a enregistré entre-temps, fusionne et recommence. */
  const flush = useCallback(async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const mine = stateRef.current;
      if (!mine) return;
      if (baseRef.current && versionRef.current > 0 && same(mine, baseRef.current)) {
        synced(versionRef.current, mine);
        return;
      }
      const r = await pushRemote(SYNC, mine, versionRef.current);
      if (r.ok) {
        synced(r.version, mine);
        if (stateRef.current === mine) return;
        continue; // modifié pendant l'envoi
      }
      const current = stateRef.current ?? mine;
      commit(baseRef.current ? merge3(baseRef.current, current, r.remote.state) : r.remote.state);
      versionRef.current = r.remote.version;
      baseRef.current = r.remote.state;
    }
  }, [commit, synced]);

  /** Une passe complète : récupérer la base, fusionner ce qui est en attente, envoyer. */
  const run = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setSync({ phase: 'syncing', lastSync: lastSyncRef.current });
    try {
      const remote = await fetchRemote(SYNC);
      const local = stateRef.current;
      const base = baseRef.current;
      // Sans version de référence (premier passage sur cet appareil), seule une
      // configuration réellement saisie est à envoyer — pas l'équipe d'exemple.
      const pending = !!local && (base ? !same(local, base) : !isPristine(local));

      if (!remote) {
        // Base vide : on y dépose ce que cet appareil a, s'il a été configuré.
        versionRef.current = 0;
        baseRef.current = null;
        if (pending) await flush();
        else setSync({ phase: 'ok', lastSync: (lastSyncRef.current = Date.now()) });
      } else if (remote.version === versionRef.current) {
        if (pending) await flush();
        else synced(remote.version, remote.state);
      } else if (pending && local && base) {
        commit(merge3(base, local, remote.state));
        versionRef.current = remote.version;
        baseRef.current = remote.state;
        await flush();
      } else {
        commit(remote.state);
        synced(remote.version, remote.state);
      }
    } catch (e) {
      fail(e);
    } finally {
      busyRef.current = false;
    }
  }, [commit, fail, flush, synced]);

  const schedule = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void run(), 600);
  }, [run]);

  // Démarrage : copie locale tout de suite, puis la base.
  useEffect(() => {
    if (window.location.hash) history.replaceState(null, '', window.location.pathname + window.location.search);
    const meta = loadMeta();
    if (meta) {
      versionRef.current = meta.version;
      baseRef.current = meta.base;
    }
    commit(loadLocal() ?? defaultState());
    void run();
  }, [commit, run]);

  useEffect(() => {
    if (state) saveLocal(state);
  }, [state]);

  useEffect(() => {
    const tick = () => document.visibilityState === 'visible' && void run();
    const id = setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('online', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('online', tick);
    };
  }, [run]);

  const update = useCallback(
    (fn: (s: PlanState) => PlanState) => {
      const cur = stateRef.current;
      if (!cur) return;
      commit(fn(cur));
      schedule();
    },
    [commit, schedule],
  );

  const replace = useCallback(
    (s: PlanState) => {
      commit(s);
      schedule();
    },
    [commit, schedule],
  );

  return { state, update, replace, sync, syncNow: run };
}
