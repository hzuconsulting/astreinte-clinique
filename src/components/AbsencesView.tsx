'use client';
import { useState } from 'react';
import { diffDays, eachDay, formatShort, todayISO } from '@/lib/dates';
import { uid, type PlanState } from '@/lib/model';
import { suggest } from '@/lib/scheduler';
import { Button, Card, DoctorChip, inputCls } from './ui';

type Props = { state: PlanState; update: (fn: (s: PlanState) => PlanState) => void };

const LABELS = ['Vacances', 'Congrès', 'Formation', 'Récupération', 'Maladie'];

export function AbsencesView({ state, update }: Props) {
  const [doctorId, setDoctorId] = useState(state.doctors[0]?.id ?? '');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [label, setLabel] = useState('Vacances');
  const [showPast, setShowPast] = useState(false);
  const today = todayISO();
  const docs = new Map(state.doctors.map((d) => [d.id, d]));

  const conflictsOf = (a: PlanState['absences'][number]) =>
    eachDay(a.start, a.end).filter((d) => state.assignments[d]?.doctorId === a.doctorId);

  const list = [...state.absences]
    .filter((a) => showPast || a.end >= today)
    .sort((a, b) => a.start.localeCompare(b.start));
  const pastCount = state.absences.filter((a) => a.end < today).length;

  /** Réattribue les jours en conflit au meilleur remplaçant disponible. */
  const fix = (days: string[]) =>
    update((s) => {
      let cur = s;
      for (const d of days) {
        const unlocked = { ...cur, assignments: { ...cur.assignments } };
        delete unlocked.assignments[d];
        const best = suggest(unlocked, d).find((x) => !x.blocked);
        unlocked.assignments = { ...unlocked.assignments };
        if (best) unlocked.assignments[d] = { doctorId: best.doctorId, locked: false };
        cur = unlocked;
      }
      return cur;
    });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-ink">Absences</h1>
      <Card>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!doctorId || !start) return;
            const e2 = end && end >= start ? end : start;
            update((s) => ({ ...s, absences: [...s.absences, { id: uid(), doctorId, start, end: e2, label }] }));
            setStart('');
            setEnd('');
          }}
        >
          <div className="flex flex-wrap gap-2">
            {state.doctors.map((d) => (
              <button
                type="button"
                key={d.id}
                onClick={() => setDoctorId(d.id)}
                className={`inline-flex min-h-[44px] items-center gap-2 rounded-xl border px-3 text-sm font-semibold ${doctorId === d.id ? 'border-teal bg-teal-light text-teal-dark' : 'border-line text-ink'}`}
              >
                <DoctorChip doctor={d} size="sm" /> {d.name}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-muted">Du<input required type="date" className={inputCls} value={start} onChange={(e) => { setStart(e.target.value); if (!end || end < e.target.value) setEnd(e.target.value); }} /></label>
            <label className="text-xs text-muted">Au (inclus)<input type="date" min={start} className={inputCls} value={end} onChange={(e) => setEnd(e.target.value)} /></label>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {LABELS.map((l) => (
              <button type="button" key={l} onClick={() => setLabel(l)} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${label === l ? 'bg-ink text-white' : 'bg-paper text-muted'}`}>
                {l}
              </button>
            ))}
          </div>
          <Button type="submit" className="w-full" disabled={!start || !doctorId}>Ajouter l’absence</Button>
        </form>
      </Card>

      {list.length === 0 && <p className="text-center text-sm text-muted">Aucune absence à venir.</p>}
      <ul className="space-y-2">
        {list.map((a) => {
          const conflicts = conflictsOf(a);
          return (
            <li key={a.id}>
              <Card className="!p-3">
                <div className="flex items-center gap-3">
                  <DoctorChip doctor={docs.get(a.doctorId)} />
                  <div className="flex-1 text-sm">
                    <p className="font-semibold text-ink">
                      {docs.get(a.doctorId)?.name} · {a.label}
                    </p>
                    <p className="text-muted">
                      {a.start === a.end ? formatShort(a.start) : `${formatShort(a.start)} → ${formatShort(a.end)}`} ({diffDays(a.start, a.end) + 1} j)
                    </p>
                  </div>
                  <button
                    onClick={() => update((s) => ({ ...s, absences: s.absences.filter((x) => x.id !== a.id) }))}
                    className="rounded-lg px-2 py-1 text-xl text-muted hover:bg-rose-light hover:text-rose"
                    aria-label="Supprimer l’absence"
                  >
                    ×
                  </button>
                </div>
                {conflicts.length > 0 && (
                  <div className="mt-2 flex items-center justify-between gap-2 rounded-xl bg-rose-light px-3 py-2 text-xs text-rose">
                    <span>{conflicts.length} astreinte{conflicts.length > 1 ? 's' : ''} pendant l’absence</span>
                    <button className="font-bold underline" onClick={() => fix(conflicts)}>Réattribuer</button>
                  </div>
                )}
              </Card>
            </li>
          );
        })}
      </ul>
      {pastCount > 0 && (
        <button className="w-full text-center text-xs font-semibold text-muted" onClick={() => setShowPast((v) => !v)}>
          {showPast ? 'Masquer' : 'Afficher'} les absences passées ({pastCount})
        </button>
      )}
    </div>
  );
}
