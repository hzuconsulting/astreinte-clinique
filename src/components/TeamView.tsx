'use client';
import { useState } from 'react';
import { formatShort, WEEKDAY_LABEL, WEEKDAY_SHORT, type Weekday } from '@/lib/dates';
import { frenchHolidays } from '@/lib/holidays';
import { DOCTOR_COLORS, uid, type Doctor, type PlanState } from '@/lib/model';
import { Button, Card, DoctorChip, Toggle, inputCls } from './ui';

type Props = { state: PlanState; update: (fn: (s: PlanState) => PlanState) => void; year: number };

export function TeamView({ state, update, year }: Props) {
  const setDoc = (id: string, patch: Partial<Doctor>) =>
    update((s) => ({ ...s, doctors: s.doctors.map((d) => (d.id === id ? { ...d, ...patch } : d)) }));

  const remove = (id: string) => {
    const doc = state.doctors.find((d) => d.id === id);
    if (!doc || !confirm(`Retirer ${doc.name} de l’équipe ? Ses astreintes et absences seront supprimées.`)) return;
    update((s) => ({
      ...s,
      doctors: s.doctors.filter((d) => d.id !== id),
      absences: s.absences.filter((a) => a.doctorId !== id),
      assignments: Object.fromEntries(Object.entries(s.assignments).filter(([, a]) => a.doctorId !== id)),
    }));
  };

  const add = () =>
    update((s) => ({
      ...s,
      doctors: [
        ...s.doctors,
        { id: uid(), name: `Dr ${String.fromCharCode(65 + s.doctors.length)}`, color: DOCTOR_COLORS[s.doctors.length % DOCTOR_COLORS.length]!, offWeekdays: [], share: 100 },
      ],
    }));

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-ink">Équipe</h1>
      {state.doctors.map((d) => (
        <Card key={d.id}>
          <div className="flex items-center gap-3">
            <DoctorChip doctor={d} />
            <input className={inputCls} value={d.name} onChange={(e) => setDoc(d.id, { name: e.target.value })} aria-label="Nom" />
          </div>
          <div className="mt-3 flex gap-2">
            {DOCTOR_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setDoc(d.id, { color: c })}
                className={`h-7 w-7 rounded-full ${d.color === c ? 'ring-2 ring-ink ring-offset-2' : ''}`}
                style={{ background: c }}
                aria-label={`Couleur ${c}`}
              />
            ))}
          </div>

          <p className="mb-2 mt-4 text-sm font-semibold text-ink">Jours travaillés chaque semaine</p>
          <div className="grid grid-cols-7 gap-1.5">
            {WEEKDAY_SHORT.map((w, i) => {
              const wd = i as Weekday;
              const works = !d.offWeekdays.includes(wd);
              return (
                <button
                  key={i}
                  onClick={() =>
                    setDoc(d.id, {
                      offWeekdays: works ? [...d.offWeekdays, wd].sort() : d.offWeekdays.filter((x) => x !== wd),
                    })
                  }
                  aria-pressed={works}
                  title={`${WEEKDAY_LABEL[i]} : ${works ? 'travaillé' : 'non travaillé'}`}
                  className={`h-11 rounded-xl text-sm font-bold transition ${works ? 'bg-teal text-white' : 'border border-dashed border-line bg-paper text-muted line-through'}`}
                >
                  {w}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-muted">
            {d.offWeekdays.length === 0
              ? 'Disponible tous les jours.'
              : `Jamais d’astreinte le ${d.offWeekdays.map((x) => WEEKDAY_LABEL[x]!.toLowerCase()).join(', le ')}.`}
          </p>

          <label className="mt-4 flex items-center justify-between gap-3 text-sm">
            <span>
              <span className="block font-semibold text-ink">Part de la charge</span>
              <span className="block text-xs text-muted">100 % = part égale. 50 % = moitié moins d’astreintes.</span>
            </span>
            <select className={`${inputCls} !w-28`} value={d.share} onChange={(e) => setDoc(d.id, { share: Number(e.target.value) })}>
              {[100, 90, 80, 75, 60, 50, 40, 25].map((p) => (
                <option key={p} value={p}>{p} %</option>
              ))}
            </select>
          </label>

          {state.doctors.length > 1 && (
            <button onClick={() => remove(d.id)} className="mt-3 text-xs font-semibold text-rose">Retirer de l’équipe</button>
          )}
        </Card>
      ))}
      <Button variant="ghost" className="w-full" onClick={add}>+ Ajouter un médecin</Button>

      <SettingsCard state={state} update={update} year={year} />
    </div>
  );
}

function SettingsCard({ state, update, year }: Props) {
  const s = state.settings;
  const set = (patch: Partial<PlanState['settings']>) => update((st) => ({ ...st, settings: { ...st.settings, ...patch } }));
  const [hDate, setHDate] = useState('');
  const [hName, setHName] = useState('');
  const official = frenchHolidays(year, s.alsaceMoselle);
  return (
    <Card>
      <h2 className="mb-2 text-base font-bold text-ink">Règles de l’assistant</h2>
      <label className="flex items-center justify-between gap-3 py-2 text-sm">
        <span>
          <span className="block font-medium text-ink">Week-end d’astreinte</span>
          <span className="block text-xs text-muted">Ces jours comptent comme week-end dans l’équité.</span>
        </span>
        <select className={`${inputCls} !w-40`} value={s.weekendStart} onChange={(e) => set({ weekendStart: Number(e.target.value) as 4 | 5 })}>
          <option value={4}>Ven. → dim.</option>
          <option value={5}>Sam. → dim.</option>
        </select>
      </label>
      <Toggle
        checked={s.groupWeekends}
        onChange={(v) => set({ groupWeekends: v })}
        label="Week-end entier à la même personne"
        hint={`${s.weekendStart === 4 ? 'Vendredi, samedi et dimanche' : 'Samedi et dimanche'}, plus le férié accolé (jeudi de l’Ascension, lundi de Pâques…).`}
      />
      <label className="flex items-center justify-between gap-3 py-2 text-sm">
        <span>
          <span className="block font-medium text-ink">Repos entre deux astreintes</span>
          <span className="block text-xs text-muted">Nombre de jours libres souhaités au minimum (hors week-end groupé).</span>
        </span>
        <select className={`${inputCls} !w-24`} value={s.minRest} onChange={(e) => set({ minRest: Number(e.target.value) })}>
          {[0, 1, 2, 3].map((n) => <option key={n} value={n}>{n} j</option>)}
        </select>
      </label>
      <Toggle checked={s.alsaceMoselle} onChange={(v) => set({ alsaceMoselle: v })} label="Fériés d’Alsace-Moselle" hint="Ajoute Vendredi saint et 26 décembre." />

      <h3 className="mb-2 mt-4 text-sm font-bold text-ink">Jours fériés {year}</h3>
      <ul className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
        {official.map((h) => (
          <li key={h.date} className="flex justify-between rounded-lg bg-paper px-3 py-1.5">
            <span className="text-ink">{h.name}</span>
            <span className="text-muted">{formatShort(h.date)}</span>
          </li>
        ))}
        {s.customHolidays.map((h) => (
          <li key={h.date} className="flex items-center justify-between rounded-lg bg-amber-light px-3 py-1.5">
            <span className="text-ink">{h.name}</span>
            <span className="flex items-center gap-2 text-muted">
              {formatShort(h.date)}
              <button aria-label="Supprimer" className="text-rose" onClick={() => set({ customHolidays: s.customHolidays.filter((x) => x.date !== h.date) })}>×</button>
            </span>
          </li>
        ))}
      </ul>
      <form
        className="mt-3 grid grid-cols-[1fr_1fr_auto] gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!hDate) return;
          set({ customHolidays: [...s.customHolidays.filter((x) => x.date !== hDate), { date: hDate, name: hName || 'Jour spécial' }].sort((a, b) => a.date.localeCompare(b.date)) });
          setHDate('');
          setHName('');
        }}
      >
        <input type="date" className={inputCls} value={hDate} onChange={(e) => setHDate(e.target.value)} aria-label="Date" />
        <input className={inputCls} placeholder="Ex. fermeture clinique" value={hName} onChange={(e) => setHName(e.target.value)} />
        <Button type="submit" variant="soft">Ajouter</Button>
      </form>
      <p className="mt-1 text-xs text-muted">Un jour ajouté ici compte comme un férié dans la répartition.</p>
    </Card>
  );
}
