'use client';
import { useCallback, useEffect, useState } from 'react';
import { defaultState, type PlanState } from '@/lib/model';
import { decodeShare, loadLocal, saveLocal } from '@/lib/storage';

/**
 * L'état du planning vit dans le navigateur (localStorage). Un lien de partage
 * `#p=…` apporte une autre version : on l'adopte d'office si rien n'existe
 * encore ici, sinon on demande avant d'écraser.
 */
export function usePlan() {
  const [state, setState] = useState<PlanState | null>(null);
  const [incoming, setIncoming] = useState<PlanState | null>(null);

  useEffect(() => {
    void (async () => {
      const local = loadLocal();
      const m = window.location.hash.match(/^#p=(.+)$/);
      const shared = m ? await decodeShare(m[1]!) : null;
      if (m) history.replaceState(null, '', window.location.pathname + window.location.search);
      if (shared && !local) {
        setState(shared);
      } else {
        setState(local ?? defaultState());
        if (shared && JSON.stringify(shared) !== JSON.stringify(local)) setIncoming(shared);
      }
    })();
  }, []);

  useEffect(() => {
    if (state) saveLocal(state);
  }, [state]);

  const update = useCallback((fn: (s: PlanState) => PlanState) => setState((s) => (s ? fn(s) : s)), []);
  const replace = useCallback((s: PlanState) => setState(s), []);

  return {
    state,
    update,
    replace,
    incoming,
    acceptIncoming: () => {
      if (incoming) setState(incoming);
      setIncoming(null);
    },
    dismissIncoming: () => setIncoming(null),
  };
}
