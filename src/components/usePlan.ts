'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { defaultState, type PlanState } from '@/lib/model';
import { decodeShare, loadLocal, saveLocal } from '@/lib/storage';
import {
  decodeInvite, fetchRemote, loadSyncConfig, merge3, pushRemote, saveSyncConfig, SyncError, type SyncConfig,
} from '@/lib/sync';

export type SyncStatus =
  | { mode: 'local' }
  | { mode: 'online'; phase: 'syncing' | 'ok' | 'error'; error?: string; lastSync?: number };

const META_KEY = 'astreinte-clinique:sync-meta';
const POLL_MS = 15_000;

/** Dernière version synchronisée, gardée pour fusionner les modifications faites hors ligne. */
function loadMeta(): { version: number; base: PlanState } | null {
  try {
    return JSON.parse(localStorage.getItem(META_KEY) ?? 'null');
  } catch {
    return null;
  }
}
function saveMeta(version: number, base: PlanState | null) {
  try {
    if (base) localStorage.setItem(META_KEY, JSON.stringify({ version, base }));
    else localStorage.removeItem(META_KEY);
  } catch {
    /* ignoré */
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * L'état du planning. En mode local, il vit dans le navigateur. En mode
 * équipe, chaque modification est envoyée en ligne (après une courte pause),
 * et les modifications des collègues sont récupérées toutes les 15 s et au
 * retour sur l'appli.
 */
export function usePlan() {
  const [state, setState] = useState<PlanState | null>(null);
  const [incoming, setIncoming] = useState<PlanState | null>(null);
  const [sync, setSync] = useState<SyncStatus>({ mode: 'local' });
  const [config, setConfig] = useState<SyncConfig | null>(null);

  const stateRef = useRef<PlanState | null>(null);
  const cfgRef = useRef<SyncConfig | null>(null);
  const baseRef = useRef<PlanState | null>(null);
  const versionRef = useRef(0);
  const savingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const commit = useCallback((s: PlanState) => {
    stateRef.current = s;
    setState(s);
  }, []);

  const markSynced = useCallback((version: number, base: PlanState) => {
    versionRef.current = version;
    baseRef.current = base;
    saveMeta(version, base);
    setSync({ mode: 'online', phase: 'ok', lastSync: Date.now() });
  }, []);

  const fail = useCallback((e: unknown) => {
    setSync((s) => ({
      mode: 'online',
      phase: 'error',
      error: e instanceof SyncError ? e.message : 'Erreur de synchronisation',
      lastSync: s.mode === 'online' ? s.lastSync : undefined,
    }));
  }, []);

  /** Envoie l'état courant ; en cas d'enregistrement concurrent, fusionne et recommence. */
  const flush = useCallback(async () => {
    const cfg = cfgRef.current;
    if (!cfg || savingRef.current) return;
    savingRef.current = true;
    setSync((s) => ({ mode: 'online', phase: 'syncing', lastSync: s.mode === 'online' ? s.lastSync : undefined }));
    try {
      for (let attempt = 0; attempt < 5; attempt++) {
        const mine = stateRef.current;
        if (!mine) break;
        if (baseRef.current && same(mine, baseRef.current) && versionRef.current > 0) {
          markSynced(versionRef.current, mine);
          break;
        }
        const r = await pushRemote(cfg, mine, versionRef.current);
        if (r.ok) {
          markSynced(r.version, mine);
          if (stateRef.current === mine) break;
          continue; // modifié pendant l'envoi : on renvoie
        }
        const merged = merge3(baseRef.current ?? r.remote.state, stateRef.current ?? mine, r.remote.state);
        versionRef.current = r.remote.version;
        baseRef.current = r.remote.state;
        commit(merged);
      }
    } catch (e) {
      fail(e);
    } finally {
      savingRef.current = false;
    }
  }, [commit, fail, markSynced]);

  const schedule = useCallback(() => {
    if (!cfgRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void flush(), 700);
  }, [flush]);

  /** Récupère la version en ligne et la fusionne avec ce qui n'a pas encore été envoyé. */
  const pull = useCallback(async () => {
    const cfg = cfgRef.current;
    if (!cfg || savingRef.current) return;
    try {
      const remote = await fetchRemote(cfg);
      const local = stateRef.current;
      if (!remote) {
        versionRef.current = 0;
        await flush(); // première mise en ligne
        return;
      }
      const base = baseRef.current;
      const dirty = !!local && !!base && !same(local, base);
      if (remote.version === versionRef.current) {
        if (dirty) await flush();
        else setSync({ mode: 'online', phase: 'ok', lastSync: Date.now() });
        return;
      }
      if (dirty && local && base) {
        commit(merge3(base, local, remote.state));
        versionRef.current = remote.version;
        baseRef.current = remote.state;
        await flush();
      } else {
        commit(remote.state);
        markSynced(remote.version, remote.state);
      }
    } catch (e) {
      fail(e);
    }
  }, [commit, fail, flush, markSynced]);

  const connect = useCallback(
    async (cfg: SyncConfig) => {
      saveSyncConfig(cfg);
      cfgRef.current = cfg;
      setConfig(cfg);
      setSync({ mode: 'online', phase: 'syncing' });
      await pull();
    },
    [pull],
  );

  const disconnect = useCallback(() => {
    saveSyncConfig(null);
    saveMeta(0, null);
    cfgRef.current = null;
    baseRef.current = null;
    versionRef.current = 0;
    setConfig(null);
    setSync({ mode: 'local' });
  }, []);

  // Démarrage : lien d'invitation, lien de copie, ou état enregistré.
  useEffect(() => {
    void (async () => {
      const local = loadLocal();
      const hash = window.location.hash;
      const invite = hash.match(/^#equipe=(.+)$/);
      const shareCode = hash.match(/^#p=(.+)$/);
      if (invite || shareCode) history.replaceState(null, '', window.location.pathname + window.location.search);

      const invited = invite ? decodeInvite(invite[1]!) : null;
      if (invited) {
        // Rejoindre une équipe : la version en ligne fait foi.
        commit(local ?? defaultState());
        saveMeta(0, null);
        cfgRef.current = invited;
        await connect(invited);
        return;
      }

      const shared = shareCode ? await decodeShare(shareCode[1]!) : null;
      if (shared && !local) commit(shared);
      else {
        commit(local ?? defaultState());
        if (shared && !same(shared, local)) setIncoming(shared);
      }

      const cfg = loadSyncConfig();
      if (cfg) {
        const meta = loadMeta();
        if (meta) {
          versionRef.current = meta.version;
          baseRef.current = meta.base;
        }
        await connect(cfg);
      }
    })();
  }, [commit, connect]);

  useEffect(() => {
    if (state) saveLocal(state);
  }, [state]);

  // Récupération régulière des modifications des collègues.
  useEffect(() => {
    if (!config) return;
    const tick = () => document.visibilityState === 'visible' && void pull();
    const id = setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('online', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('online', tick);
    };
  }, [config, pull]);

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

  return {
    state,
    update,
    replace,
    sync,
    config,
    connect,
    disconnect,
    syncNow: pull,
    incoming,
    acceptIncoming: () => {
      if (incoming) replace(incoming);
      setIncoming(null);
    },
    dismissIncoming: () => setIncoming(null),
  };
}
