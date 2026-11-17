'use client';
import { useState } from 'react';
import { todayISO } from '@/lib/dates';
import { AbsencesView } from '@/components/AbsencesView';
import { PlanningView } from '@/components/PlanningView';
import { ShareView } from '@/components/ShareView';
import { StatsView } from '@/components/StatsView';
import { TeamView } from '@/components/TeamView';
import { Button } from '@/components/ui';
import { usePlan } from '@/components/usePlan';

const TABS = [
  { id: 'planning', label: 'Planning', icon: '📅' },
  { id: 'absences', label: 'Absences', icon: '🏖️' },
  { id: 'equipe', label: 'Équipe', icon: '👥' },
  { id: 'bilan', label: 'Bilan', icon: '⚖️' },
  { id: 'partage', label: 'Partager', icon: '🔗' },
] as const;
type Tab = (typeof TABS)[number]['id'];

export default function Home() {
  const { state, update, replace, incoming, acceptIncoming, dismissIncoming } = usePlan();
  const [tab, setTab] = useState<Tab>('planning');
  const t = todayISO();
  const [cursor, setCursor] = useState({ year: Number(t.slice(0, 4)), month: Number(t.slice(5, 7)) });
  const setYear = (year: number) => setCursor((c) => ({ ...c, year }));

  if (!state) return <main className="grid min-h-screen place-items-center text-muted">Chargement…</main>;

  return (
    <div className="min-h-screen pb-24 sm:pb-8">
      <header className="no-print sticky top-0 z-40 border-b border-line bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <span className="flex items-center gap-2 font-bold text-ink">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-teal text-sm text-white">A</span>
            Astreintes
          </span>
          <nav className="hidden gap-1 sm:flex">
            {TABS.map((x) => (
              <button
                key={x.id}
                onClick={() => setTab(x.id)}
                className={`rounded-lg px-3 py-2 text-sm font-semibold ${tab === x.id ? 'bg-teal-light text-teal-dark' : 'text-muted hover:text-ink'}`}
              >
                {x.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-3 py-4 sm:px-4">
        {incoming && (
          <div className="no-print mb-4 rounded-2xl border border-teal bg-teal-light p-4 text-sm text-teal-dark">
            <p className="font-semibold">Tu as ouvert un planning partagé.</p>
            <p className="mt-1">Il est différent de celui enregistré sur cet appareil. Le remplacer ?</p>
            <div className="mt-3 flex gap-2">
              <Button onClick={acceptIncoming}>Remplacer</Button>
              <Button variant="ghost" onClick={dismissIncoming}>Garder le mien</Button>
            </div>
          </div>
        )}
        {tab === 'planning' && <PlanningView state={state} update={update} cursor={cursor} setCursor={setCursor} />}
        {tab === 'absences' && <AbsencesView state={state} update={update} />}
        {tab === 'equipe' && <TeamView state={state} update={update} year={cursor.year} />}
        {tab === 'bilan' && <StatsView state={state} year={cursor.year} setYear={setYear} />}
        {tab === 'partage' && <ShareView state={state} replace={replace} year={cursor.year} />}
      </main>

      <nav className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white pb-[env(safe-area-inset-bottom)] sm:hidden">
        <div className="grid grid-cols-5">
          {TABS.map((x) => (
            <button
              key={x.id}
              onClick={() => setTab(x.id)}
              className={`flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold ${tab === x.id ? 'text-teal' : 'text-muted'}`}
            >
              <span className="text-lg leading-none">{x.icon}</span>
              {x.label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
