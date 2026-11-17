'use client';
import { formatShort, WEEKDAY_SHORT } from '@/lib/dates';
import type { PlanState } from '@/lib/model';
import { yearStats } from '@/lib/stats';
import { Card, DoctorChip } from './ui';

type Props = { state: PlanState; year: number; setYear: (y: number) => void };

export function StatsView({ state, year, setYear }: Props) {
  const st = yearStats(state, year);
  const docs = new Map(state.doctors.map((d) => [d.id, d]));
  const metrics = [
    { key: 'holiday', label: 'Jours fériés', get: (r: (typeof st.rows)[number]) => r.holiday },
    { key: 'weekend', label: 'Jours de week-end', get: (r: (typeof st.rows)[number]) => r.weekend },
    { key: 'total', label: 'Total des astreintes', get: (r: (typeof st.rows)[number]) => r.total },
  ];
  const maxByWd = Math.max(1, ...st.rows.flatMap((r) => r.byWeekday));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-ink">Bilan {year}</h1>
        <div className="flex gap-1">
          <button className="h-10 w-10 rounded-xl border border-line bg-white" onClick={() => setYear(year - 1)} aria-label="Année précédente">‹</button>
          <button className="h-10 w-10 rounded-xl border border-line bg-white" onClick={() => setYear(year + 1)} aria-label="Année suivante">›</button>
        </div>
      </div>

      {st.unassigned > 0 && (
        <p className="rounded-xl bg-amber-light px-3 py-2 text-sm text-amber">
          {st.unassigned} jour{st.unassigned > 1 ? 's' : ''} de {year} sans astreinte attribuée.
        </p>
      )}

      {metrics.map((m) => {
        const vals = st.rows.map((r) => {
          const share = (docs.get(r.doctorId)?.share ?? 100) / 100;
          return { r, v: m.get(r), norm: m.get(r) / share };
        });
        const max = Math.max(1, ...vals.map((x) => x.v));
        const gap = Math.max(...vals.map((x) => x.norm)) - Math.min(...vals.map((x) => x.norm));
        const ok = gap <= (m.key === 'holiday' ? 1 : m.key === 'weekend' ? 2 : 3);
        return (
          <Card key={m.key}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold text-ink">{m.label}</h2>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ok ? 'bg-teal-light text-teal-dark' : 'bg-amber-light text-amber'}`}>
                {ok ? 'Équilibré' : `Écart ${Math.round(gap)}`}
              </span>
            </div>
            <ul className="space-y-2">
              {vals.map(({ r, v }) => {
                const d = docs.get(r.doctorId)!;
                return (
                  <li key={r.doctorId} className="flex items-center gap-3 text-sm">
                    <DoctorChip doctor={d} size="sm" />
                    <span className="w-24 truncate text-ink">{d.name}</span>
                    <span className="h-3 flex-1 overflow-hidden rounded-full bg-paper">
                      <span className="block h-full rounded-full" style={{ width: `${(v / max) * 100}%`, background: d.color }} />
                    </span>
                    <b className="w-8 text-right text-ink">{v}</b>
                  </li>
                );
              })}
            </ul>
            {m.key === 'holiday' && (
              <div className="mt-3 space-y-1 text-xs text-muted">
                {st.rows.map((r) => (
                  <p key={r.doctorId}>
                    <b className="text-ink">{docs.get(r.doctorId)?.name} :</b> {r.holidayDates.map(formatShort).join(', ') || '—'}
                  </p>
                ))}
              </div>
            )}
          </Card>
        );
      })}

      <Card>
        <h2 className="mb-3 text-sm font-bold text-ink">Par jour de la semaine</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-center text-sm">
            <thead>
              <tr className="text-xs text-muted">
                <th />
                {WEEKDAY_SHORT.map((w, i) => <th key={i} className="px-1 font-semibold">{w}</th>)}
              </tr>
            </thead>
            <tbody>
              {st.rows.map((r) => {
                const d = docs.get(r.doctorId)!;
                return (
                  <tr key={r.doctorId}>
                    <td className="py-1 pr-2 text-left"><DoctorChip doctor={d} size="sm" /></td>
                    {r.byWeekday.map((n, i) => (
                      <td key={i} className="p-0.5">
                        <span
                          className="block rounded-md py-1 text-xs font-semibold"
                          style={{ background: `${d.color}${Math.round(20 + (n / maxByWd) * 180).toString(16).padStart(2, '0')}`, color: n / maxByWd > 0.55 ? 'white' : '#14213D' }}
                        >
                          {n}
                        </span>
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
