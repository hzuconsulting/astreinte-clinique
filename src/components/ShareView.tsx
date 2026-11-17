'use client';
import { useRef, useState } from 'react';
import { buildIcs } from '@/lib/ics';
import { defaultState, type PlanState } from '@/lib/model';
import { encodeShare, parseState } from '@/lib/storage';
import { encodeInvite, newTeamCode, normalizeUrl, type SyncConfig } from '@/lib/sync';
import { Button, Card, DoctorChip, inputCls } from './ui';
import type { SyncStatus } from './usePlan';

type Props = {
  state: PlanState;
  replace: (s: PlanState) => void;
  year: number;
  sync: SyncStatus;
  config: SyncConfig | null;
  connect: (c: SyncConfig) => Promise<void>;
  disconnect: () => void;
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

async function shareOrCopy(title: string, url: string): Promise<'shared' | 'copied'> {
  if (navigator.share) {
    try {
      await navigator.share({ title, url });
      return 'shared';
    } catch {
      /* annulé : on copie */
    }
  }
  await navigator.clipboard.writeText(url);
  return 'copied';
}

export function ShareView(p: Props) {
  const { state, replace, year } = p;
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-ink">Partager</h1>

      <TeamCard {...p} />

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
        {!p.config && (
          <Button
            variant="ghost"
            className="mt-2 w-full"
            onClick={async () => {
              const code = await encodeShare(state);
              const r = await shareOrCopy('Planning des astreintes', `${window.location.origin}${window.location.pathname}#p=${code}`);
              if (r === 'copied') setMsg('Lien copié : il contient une copie figée du planning actuel.');
            }}
          >
            Envoyer une copie par lien
          </Button>
        )}
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
              if (confirm(p.config ? 'Remplacer le planning de toute l’équipe par celui du fichier ?' : 'Remplacer le planning de cet appareil par celui du fichier ?')) {
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
          onClick={() => confirm(p.config ? 'Tout effacer, pour toute l’équipe (équipe, absences, planning) ?' : 'Tout effacer sur cet appareil (équipe, absences, planning) ?') && replace(defaultState())}
        >
          Tout réinitialiser
        </button>
      </Card>
    </div>
  );
}

function TeamCard({ state, sync, config, connect, disconnect, syncNow }: Props) {
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (config && sync.mode === 'online') {
    const invite = `${window.location.origin}${window.location.pathname}#equipe=${encodeInvite(config)}`;
    return (
      <Card>
        <h2 className="text-base font-bold text-ink">Espace d’équipe</h2>
        <SyncLine sync={sync} />
        <p className="mt-2 text-sm text-muted">
          Le planning est partagé en ligne : chaque modification est visible par tous en quelques secondes.
          Pour ajouter un collègue, envoie-lui le lien d’invitation. Il l’ouvre une fois, c’est tout.
        </p>
        <Button
          className="mt-3 w-full"
          onClick={async () => {
            const r = await shareOrCopy('Planning des astreintes — invitation', invite);
            if (r === 'copied') setMsg('Lien d’invitation copié. Envoie-le par SMS ou WhatsApp à tes collègues.');
          }}
        >
          Inviter un collègue
        </Button>
        {msg && <p className="mt-2 rounded-xl bg-teal-light px-3 py-2 text-sm text-teal-dark">{msg}</p>}
        <p className="mt-2 text-xs text-muted">Ce lien donne accès au planning : ne le partage qu’avec l’équipe.</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button variant="ghost" onClick={() => void syncNow()}>Actualiser</Button>
          <Button
            variant="ghost"
            onClick={() => confirm('Quitter l’espace d’équipe sur cet appareil ? Le planning reste ici, mais ne sera plus synchronisé.') && disconnect()}
          >
            Quitter
          </Button>
        </div>
      </Card>
    );
  }

  const valid = /supabase\.(co|in)|^https?:\/\//.test(url.trim()) && key.trim().length > 20;
  return (
    <Card>
      <h2 className="text-base font-bold text-ink">Travailler à plusieurs</h2>
      <p className="mt-1 text-sm text-muted">
        Pour l’instant, le planning n’est enregistré que sur cet appareil. Relie-le à ton projet Supabase pour que
        toute l’équipe voie et modifie le même planning.
      </p>
      <p className="mt-2 text-sm text-muted">
        Un collègue a déjà créé l’espace ? Ouvre simplement le lien d’invitation qu’il t’a envoyé.
      </p>
      <form
        className="mt-3 space-y-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!valid) return;
          if (!confirm(`Mettre en ligne le planning de cet appareil (${state.doctors.map((d) => d.name).join(', ')}) comme planning de l’équipe ?`)) return;
          setBusy(true);
          await connect({ url: normalizeUrl(url), key: key.trim(), code: newTeamCode() });
          setBusy(false);
        }}
      >
        <label className="block text-xs text-muted">
          URL du projet Supabase
          <input className={inputCls} placeholder="https://xxxx.supabase.co" value={url} onChange={(e) => setUrl(e.target.value)} autoCapitalize="off" autoCorrect="off" />
        </label>
        <label className="block text-xs text-muted">
          Clé publique (anon ou publishable)
          <input className={inputCls} placeholder="eyJ… ou sb_publishable_…" value={key} onChange={(e) => setKey(e.target.value)} autoCapitalize="off" autoCorrect="off" />
        </label>
        <Button type="submit" className="w-full" disabled={!valid || busy}>
          {busy ? 'Connexion…' : 'Créer l’espace d’équipe'}
        </Button>
      </form>
      {sync.mode === 'online' && sync.phase === 'error' && <p className="mt-2 rounded-xl bg-rose-light px-3 py-2 text-sm text-rose">{sync.error}</p>}
      <p className="mt-2 text-xs text-muted">N’utilise jamais la clé « service_role » ou « secret ».</p>
    </Card>
  );
}

function SyncLine({ sync }: { sync: SyncStatus }) {
  if (sync.mode !== 'online') return null;
  const when = sync.lastSync ? new Date(sync.lastSync).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : null;
  if (sync.phase === 'error') return <p className="mt-1 text-sm font-semibold text-rose">⚠ {sync.error}</p>;
  if (sync.phase === 'syncing') return <p className="mt-1 text-sm text-muted">Synchronisation…</p>;
  return <p className="mt-1 text-sm font-semibold text-teal">● Synchronisé{when ? ` à ${when}` : ''}</p>;
}
