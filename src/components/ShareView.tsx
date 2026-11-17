'use client';
import { useRef, useState } from 'react';
import { buildIcs } from '@/lib/ics';
import { defaultState, type PlanState } from '@/lib/model';
import { parseState } from '@/lib/storage';
import { Button, Card, DoctorChip } from './ui';
import type { SyncStatus } from './usePlan';

type Props = {
  state: PlanState;
  replace: (s: PlanState) => void;
  year: number;
  sync: SyncStatus;
  syncNow: () => Promise<void>;
};

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ShareView(p: Props) {
  const { state, replace, year } = p;
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-ink">Exporter</h1>

      <Card>
        <h2 className="text-base font-bold text-ink">Données partagées</h2>
        <SyncLine sync={p.sync} />
        <p className="mt-2 text-sm text-muted">
          Il n’y a qu’un seul planning, enregistré en ligne : tout le monde voit les mêmes informations, quel que soit
          celui qui les modifie. Les changements des autres apparaissent en quelques secondes.
        </p>
        <Button variant="ghost" className="mt-3 w-full" onClick={() => void p.syncNow()}>Actualiser maintenant</Button>
      </Card>

      <Card>
        <h2 className="text-base font-bold text-ink">Ajouter à mon agenda</h2>
        <p className="mt-1 text-sm text-muted">Fichier .ics des astreintes {year}, à ouvrir sur le téléphone (Calendrier, Google Agenda, Outlook).</p>
        <div className="mt-3 space-y-2">
          {state.doctors.map((d) => (
            <Button
              key={d.id}
              variant="ghost"
              className="w-full !justify-start"
              onClick={() => download(`astreintes-${year}-${d.name.replace(/\W+/g, '-')}.ics`, buildIcs(state, d.id, `${year}-01-01`, `${year}-12-31`), 'text/calendar')}
            >
              <DoctorChip doctor={d} size="sm" /> {d.name}
            </Button>
          ))}
        </div>
      </Card>

      <Card>
        <h2 className="text-base font-bold text-ink">Sauvegarde</h2>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button variant="ghost" onClick={() => download(`planning-astreintes-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(state, null, 2), 'application/json')}>
            Exporter
          </Button>
          <Button variant="ghost" onClick={() => fileRef.current?.click()}>Importer</Button>
        </div>
        {msg && <p className="mt-2 rounded-xl bg-teal-light px-3 py-2 text-sm text-teal-dark">{msg}</p>}
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try {
              const s = parseState(JSON.parse(await f.text()));
              if (!s) throw new Error();
              if (confirm('Remplacer le planning de tout le monde par celui du fichier ?')) {
                replace(s);
                setMsg('Planning importé.');
              }
            } catch {
              alert('Ce fichier n’est pas une sauvegarde de planning valide.');
            }
          }}
        />
        <button
          className="mt-4 text-xs font-semibold text-rose"
          onClick={() => confirm('Tout effacer pour tout le monde (équipe, absences, planning) ? Pense à exporter une sauvegarde avant.') && replace(defaultState())}
        >
          Tout réinitialiser
        </button>
      </Card>
    </div>
  );
}

function SyncLine({ sync }: { sync: SyncStatus }) {
  const when = 'lastSync' in sync && sync.lastSync ? new Date(sync.lastSync).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : null;
  if (sync.phase === 'error') return <p className="mt-1 text-sm font-semibold text-rose">⚠ {sync.error}{when ? ` — dernière mise à jour à ${when}` : ''}</p>;
  if (sync.phase !== 'ok') return <p className="mt-1 text-sm text-muted">Synchronisation…</p>;
  return <p className="mt-1 text-sm font-semibold text-teal">● À jour ({when})</p>;
}
