'use client';
import { useMemo, useState } from 'react';
import {
  eachDay, formatLong, formatShort, monthBounds, MONTH_LABEL, todayISO, weekday, WEEKDAY_SHORT,
  type ISODate,
} from '@/lib/dates';
import { holidayIndex, isOnCallWeekend, unavailability, type PlanState } from '@/lib/model';
import { generate, suggest, type Warning } from '@/lib/scheduler';
import { Button, Card, DoctorChip, Sheet, Toggle, inputCls } from './ui';

type Props = {
  state: PlanState;
  update: (fn: (s: PlanState) => PlanState) => void;
  cursor: { year: number; month: number };
  setCursor: (c: { year: number; month: number }) => void;
};

export function PlanningView({ state, update, cursor, setCursor }: Props) {
  const { year, month } = cursor;
  const { from, to } = monthBounds(year, month);
  const holidays = useMemo(() => holidayIndex(state.settings, year, year), [state.settings, year]);
  const docs = new Map(state.doctors.map((d) => [d.id, d]));
  const today = todayISO();
  const [day, setDay] = useState<ISODate | null>(null);
  const [genOpen, setGenOpen] = useState(false);
  const [report, setReport] = useState<{ planned: number; warnings: Warning[] } | null>(null);

  const days = eachDay(from, to);
  const lead = weekday(from);
  const cells: (ISODate | null)[] = [...Array(lead).fill(null), ...days];
  while (cells.length % 7) cells.push(null);

  const monthCounts = state.doctors.map((d) => ({
    d,
    n: days.filter((x) => state.assignments[x]?.doctorId === d.id).length,
  }));
  const empty = days.filter((x) => !state.assignments[x]).length;

  const shift = (delta: number) => {
    const m = month + delta;
    setCursor({ year: year + Math.floor((m - 1) / 12), month: ((m - 1 + 120) % 12) + 1 });
  };

  return (
    <div className="space-y-4">
      <div className="no-print flex items-center justify-between gap-2">
        <button onClick={() => shift(-1)} className="h-11 w-11 rounded-xl border border-line bg-white text-xl text-ink" aria-label="Mois précédent">‹</button>
        <h1 className="text-center text-xl font-bold capitalize text-ink">
          {MONTH_LABEL[month - 1]} {year}
        </h1>
        <button onClick={() => shift(1)} className="h-11 w-11 rounded-xl border border-line bg-white text-xl text-ink" aria-label="Mois suivant">›</button>
      </div>

      <Card className="no-print !p-2 sm:!p-3">
        <div className="grid grid-cols-7 gap-1 pb-1 text-center text-[11px] font-semibold uppercase text-muted">
          {WEEKDAY_SHORT.map((w, i) => (
            <div key={i} className={i >= state.settings.weekendStart ? 'text-teal' : ''}>{w}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((d, i) => {
            if (!d) return <div key={i} />;
            const a = state.assignments[d];
            const doc = a ? docs.get(a.doctorId) : undefined;
            const hol = holidays.get(d);
            const we = isOnCallWeekend(d, state.settings);
            const absentIds = state.doctors.filter((x) => unavailability(state, x.id, d)?.kind === 'absence');
            const conflict = a && unavailability(state, a.doctorId, d)?.kind === 'absence';
            return (
              <button
                key={d}
                onClick={() => setDay(d)}
                className={`relative flex aspect-[4/5] flex-col items-center justify-between rounded-xl border p-1 text-left transition hover:border-teal sm:aspect-square ${
                  hol ? 'border-amber/40 bg-amber-light' : we ? 'border-transparent bg-teal-light/60' : 'border-transparent bg-paper'
                } ${conflict ? '!border-rose ring-2 ring-rose/40' : ''} ${d === today ? 'outline outline-2 outline-teal' : ''}`}
                title={hol ?? undefined}
              >
                <span className={`self-start text-xs font-semibold ${hol ? 'text-amber' : 'text-ink'}`}>
                  {Number(d.slice(8))}
                  {hol && <span className="ml-0.5">★</span>}
                </span>
                {doc ? <DoctorChip doctor={doc} size="sm" /> : <span className="text-[10px] text-muted">—</span>}
                <span className="flex h-2 items-center gap-0.5">
                  {a?.locked && <span className="text-[9px] leading-none text-muted" aria-label="verrouillé">🔒</span>}
                  {absentIds.map((x) => (
                    <span key={x.id} className="h-1.5 w-1.5 rounded-full opacity-60" style={{ background: x.color }} />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
        <p className="px-1 pt-2 text-[11px] text-muted">
          ★ férié · 🔒 choix manuel, conservé · points = absents · cadre rouge = conflit avec une absence
        </p>
      </Card>

      <Card className="no-print">
        <div className="flex flex-wrap items-center gap-3">
          {monthCounts.map(({ d, n }) => (
            <span key={d.id} className="inline-flex items-center gap-2 text-sm text-ink">
              <DoctorChip doctor={d} size="sm" /> {d.name} <b>{n}</b>
            </span>
          ))}
          {empty > 0 && <span className="text-sm text-rose">{empty} jour{empty > 1 ? 's' : ''} sans astreinte</span>}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button onClick={() => setGenOpen(true)} className="col-span-2">✨ Générer avec l’assistant</Button>
          <Button variant="ghost" onClick={() => window.print()}>Imprimer</Button>
          <Button variant="ghost" onClick={() => setCursor({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) })}>
            Aujourd’hui
          </Button>
        </div>
      </Card>

      <PrintList state={state} days={days} holidays={holidays} title={`${MONTH_LABEL[month - 1]} ${year}`} />

      <GenerateSheet
        open={genOpen}
        onClose={() => setGenOpen(false)}
        state={state}
        cursor={cursor}
        onDone={(assignments, planned, warnings) => {
          update((s) => ({ ...s, assignments }));
          setGenOpen(false);
          setReport({ planned, warnings });
        }}
      />

      <Sheet open={!!report} onClose={() => setReport(null)} title="Planning généré">
        {report && (
          <div className="space-y-3 text-sm text-ink">
            <p>{report.planned} jours ont été attribués, en équilibrant fériés, week-ends et total sur l’année.</p>
            {report.warnings.length === 0 ? (
              <p className="rounded-xl bg-teal-light p-3 text-teal-dark">Aucun conflit : chaque jour a un médecin disponible.</p>
            ) : (
              <div className="rounded-xl bg-rose-light p-3">
                <p className="mb-2 font-semibold text-rose">À vérifier ({report.warnings.length})</p>
                <ul className="space-y-1">
                  {report.warnings.map((w) => (
                    <li key={w.date + w.message}>
                      <b>{formatShort(w.date)}</b> — {w.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-muted">Consulte l’onglet Bilan pour voir la répartition détaillée.</p>
            <Button className="w-full" onClick={() => setReport(null)}>OK</Button>
          </div>
        )}
      </Sheet>

      <DaySheet date={day} onClose={() => setDay(null)} state={state} update={update} holidays={holidays} />
    </div>
  );
}

function PrintList({ state, days, holidays, title }: { state: PlanState; days: ISODate[]; holidays: Map<ISODate, string>; title: string }) {
  const docs = new Map(state.doctors.map((d) => [d.id, d]));
  return (
    <div className="hidden print:block">
      <h2 className="mb-2 text-lg font-bold capitalize">Astreintes — {title}</h2>
      <table className="w-full border-collapse text-sm">
        <tbody>
          {days.map((d) => (
            <tr key={d} className={isOnCallWeekend(d, state.settings) || holidays.has(d) ? 'bg-gray-100' : ''}>
              <td className="border px-2 py-0.5">{formatShort(d)}</td>
              <td className="border px-2 py-0.5">{holidays.get(d) ?? ''}</td>
              <td className="border px-2 py-0.5 font-semibold">{docs.get(state.assignments[d]?.doctorId ?? '')?.name ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GenerateSheet({
  open, onClose, state, cursor, onDone,
}: {
  open: boolean;
  onClose: () => void;
  state: PlanState;
  cursor: { year: number; month: number };
  onDone: (a: PlanState['assignments'], planned: number, w: Warning[]) => void;
}) {
  const [mode, setMode] = useState<'month' | 'rest' | 'year' | 'custom'>('month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [keep, setKeep] = useState(false);
  const [busy, setBusy] = useState(false);
  const [seed, setSeed] = useState(1);

  const m = monthBounds(cursor.year, cursor.month);
  const range =
    mode === 'month' ? m
      : mode === 'rest' ? { from: m.from, to: `${cursor.year}-12-31` }
        : mode === 'year' ? { from: `${cursor.year}-01-01`, to: `${cursor.year}-12-31` }
          : { from: customFrom, to: customTo };
  const valid = !!range.from && !!range.to && range.from <= range.to;
  const locked = valid ? eachDay(range.from, range.to).filter((d) => state.assignments[d]?.locked).length : 0;

  const run = () => {
    if (!valid) return;
    setBusy(true);
    // On laisse le navigateur afficher « Calcul… » avant le calcul (quelques centaines de ms).
    setTimeout(() => {
      const r = generate(state, { from: range.from, to: range.to, seed, replaceUnlocked: !keep });
      const planned = eachDay(range.from, range.to).filter((d) => r.assignments[d]).length;
      setSeed((x) => x + 1);
      setBusy(false);
      onDone(r.assignments, planned, r.warnings);
    }, 30);
  };

  const opts = [
    ['month', `Ce mois (${MONTH_LABEL[cursor.month - 1]})`],
    ['rest', `D’ici à la fin ${cursor.year}`],
    ['year', `Toute l’année ${cursor.year}`],
    ['custom', 'Période personnalisée'],
  ] as const;

  return (
    <Sheet open={open} onClose={onClose} title="Générer le planning">
      <div className="space-y-4 text-sm">
        <p className="text-muted">
          L’assistant attribue chaque jour en respectant absences et jours non travaillés, puis équilibre sur l’année :
          d’abord les fériés, ensuite les week-ends, enfin le total.
        </p>
        <div className="space-y-2">
          {opts.map(([k, label]) => (
            <label key={k} className={`flex min-h-[44px] cursor-pointer items-center gap-3 rounded-xl border px-3 ${mode === k ? 'border-teal bg-teal-light' : 'border-line'}`}>
              <input type="radio" name="mode" checked={mode === k} onChange={() => setMode(k)} className="accent-teal" />
              <span className="font-medium text-ink">{label}</span>
            </label>
          ))}
        </div>
        {mode === 'custom' && (
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-muted">Du<input type="date" className={inputCls} value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} /></label>
            <label className="text-xs text-muted">Au<input type="date" className={inputCls} value={customTo} onChange={(e) => setCustomTo(e.target.value)} /></label>
          </div>
        )}
        <Toggle
          checked={keep}
          onChange={setKeep}
          label="Ne remplir que les jours vides"
          hint="Sinon, les jours déjà attribués (non verrouillés) sont recalculés."
        />
        {locked > 0 && <p className="text-xs text-muted">🔒 {locked} jour{locked > 1 ? 's' : ''} verrouillé{locked > 1 ? 's' : ''} seront conservés.</p>}
        <Button className="w-full" onClick={run} disabled={!valid || busy || state.doctors.length === 0}>
          {busy ? 'Calcul en cours…' : 'Lancer'}
        </Button>
        <p className="text-xs text-muted">Relancer donne une autre répartition, tout aussi équitable.</p>
      </div>
    </Sheet>
  );
}

function DaySheet({
  date, onClose, state, update, holidays,
}: {
  date: ISODate | null;
  onClose: () => void;
  state: PlanState;
  update: (fn: (s: PlanState) => PlanState) => void;
  holidays: Map<ISODate, string>;
}) {
  const suggestions = useMemo(() => (date ? suggest(state, date) : []), [state, date]);
  if (!date) return null;
  const a = state.assignments[date];
  const docs = new Map(state.doctors.map((d) => [d.id, d]));
  const bestOk = suggestions.find((s) => !s.blocked && !s.notes.includes('Jour non travaillé'));
  const set = (doctorId: string | null, locked = true) =>
    update((s) => {
      const assignments = { ...s.assignments };
      if (doctorId) assignments[date] = { doctorId, locked };
      else delete assignments[date];
      return { ...s, assignments };
    });

  return (
    <Sheet open onClose={onClose} title={<span className="capitalize">{formatLong(date)}</span>}>
      <div className="space-y-4 text-sm">
        {holidays.get(date) && <p className="rounded-xl bg-amber-light px-3 py-2 font-medium text-amber">★ Férié : {holidays.get(date)}</p>}
        <p className="text-muted">
          {a ? (
            <>D’astreinte : <b className="text-ink">{docs.get(a.doctorId)?.name ?? '?'}</b> {a.locked ? '(choix manuel 🔒)' : '(proposé par l’assistant)'}</>
          ) : (
            'Personne n’est d’astreinte ce jour.'
          )}
        </p>
        <div>
          <p className="mb-2 font-semibold text-ink">Choisir — classés par l’assistant</p>
          <ul className="space-y-2">
            {suggestions.map((s) => {
              const doc = docs.get(s.doctorId)!;
              const current = a?.doctorId === s.doctorId;
              return (
                <li key={s.doctorId}>
                  <button
                    disabled={!!s.blocked}
                    onClick={() => {
                      set(s.doctorId);
                      onClose();
                    }}
                    className={`flex min-h-[52px] w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition ${
                      current ? 'border-teal bg-teal-light' : 'border-line hover:border-teal'
                    } disabled:cursor-not-allowed disabled:opacity-50`}
                  >
                    <DoctorChip doctor={doc} />
                    <span className="flex-1">
                      <span className="block font-semibold text-ink">
                        {doc.name}
                        {bestOk?.doctorId === s.doctorId && <span className="ml-2 rounded-full bg-teal px-2 py-0.5 text-[10px] font-bold uppercase text-white">Recommandé</span>}
                      </span>
                      <span className="block text-xs text-muted">
                        {s.blocked ? `Absent — ${s.blocked}` : s.notes.length ? s.notes.join(' · ') : 'Disponible'}
                      </span>
                    </span>
                    {current && <span className="text-teal">✓</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {a?.locked && (
            <Button variant="soft" onClick={() => set(a.doctorId, false)}>Déverrouiller</Button>
          )}
          {a && (
            <Button variant="danger" onClick={() => { set(null); onClose(); }}>Vider ce jour</Button>
          )}
        </div>
        <p className="text-xs text-muted">
          Un choix manuel est verrouillé : l’assistant ne le modifiera plus lors des prochaines générations.
        </p>
      </div>
    </Sheet>
  );
}
