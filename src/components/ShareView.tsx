'use client';
import { useRef, useState } from 'react';
import { buildIcs } from '@/lib/ics';
import { defaultState, type PlanState } from '@/lib/model';
import { encodeShare, parseState } from '@/lib/storage';
import { Button, Card, DoctorChip } from './ui';

type Props = { state: PlanState; replace: (s: PlanState) => void; year: number };

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ShareView({ state, replace, year }: Props) {
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const shareLink = async () => {
    const code = await encodeShare(state);
    const url = `${window.location.origin}${window.location.pathname}#p=${code}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Planning des astreintes', url });
        return;
      } catch {
        /* annulé : on retombe sur la copie */
      }
    }
    await navigator.clipboard.writeText(url);
    setMsg('Lien copié. Envoie-le à tes collègues : en l’ouvrant, ils récupèrent cette version du planning.');
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-ink">Partager</h1>

      <Card>
        <h2 className="text-base font-bold text-ink">Envoyer le planning à l’équipe</h2>
        <p className="mt-1 text-sm text-muted">
          Le planning est enregistré sur cet appareil. Le lien contient toute la version actuelle (équipe, absences,
          astreintes) : celui qui l’ouvre peut la reprendre sur son téléphone. Après une modification, renvoie un nouveau lien.
        </p>
        <Button className="mt-3 w-full" onClick={shareLink}>Partager le lien du planning</Button>
        {msg && <p className="mt-2 rounded-xl bg-teal-light px-3 py-2 text-sm text-teal-dark">{msg}</p>}
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
              if (confirm('Remplacer le planning de cet appareil par celui du fichier ?')) {
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
          onClick={() => confirm('Tout effacer sur cet appareil (équipe, absences, planning) ?') && replace(defaultState())}
        >
          Tout réinitialiser
        </button>
      </Card>
    </div>
  );
}
