// "Your jobs today": the same rules the backend uses for the morning
// reminder (backend/Code.gs → responsibilitiesFor_).

import type { Bootstrap, Day, Duty, FormReq, Stayover, Submission } from '../api/types';
import { daysBetween, isoLocal } from './dates';

export function namesIn(field: string): string[] {
  return String(field || '').split(/[,&/]| and /i).map(s => s.trim()).filter(Boolean);
}
export function hasName(field: string, name: string): boolean {
  const l = namesIn(field).map(s => s.toLowerCase());
  return l.includes(name.toLowerCase()) || l.includes('everyone') || l.includes('all');
}

export function firstNight(boot: Bootstrap, s: Stayover): Day | undefined {
  return boot.itinerary.find(d => d.stayoverId === s.id);
}
export function nightsAt(boot: Bootstrap, s: Stayover): Day[] {
  return boot.itinerary.filter(d => d.stayoverId === s.id);
}

export type CallStatus = 'confirmed' | 'due' | 'overdue-past' | 'later' | 'past';
export function callStatus(boot: Bootstrap, s: Stayover, today = isoLocal()): { status: CallStatus; daysAway: number | null; day?: Day } {
  const d = firstNight(boot, s);
  if (!d) return { status: s.confirmed ? 'confirmed' : 'later', daysAway: null };
  const gap = daysBetween(today, d.date);
  if (s.confirmed) return { status: 'confirmed', daysAway: gap, day: d };
  if (gap < 0) return { status: 'past', daysAway: gap, day: d };
  if (gap <= (boot.config.confirmDaysAhead || 5)) return { status: 'due', daysAway: gap, day: d };
  return { status: 'later', daysAway: gap, day: d };
}

export type Job =
  | { kind: 'driver'; day: Day }
  | { kind: 'driver-tomorrow'; day: Day }
  | { kind: 'route'; day: Day }
  | { kind: 'duty'; duty: Duty }
  | { kind: 'call'; stayover: Stayover; day: Day; daysAway: number }
  | { kind: 'forms'; todo: FormToDo[] };

export type FormState = 'Missing' | 'Submitted' | 'Approved' | 'Needs redo';
export interface FormToDo { form: FormReq; status: FormState; last?: Submission }

/** Latest submission per form for one rider (from that rider's list, or a leader's full list). */
export function formStates(forms: FormReq[], subs: Submission[], rider: string): FormToDo[] {
  const latest = new Map<string, Submission>();
  [...subs].filter(x => x.rider.toLowerCase() === rider.toLowerCase())
    .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)))
    .forEach(x => latest.set(String(x.formId), x));
  return forms.map(form => {
    const last = latest.get(form.id);
    return { form, last, status: (last ? last.status : 'Missing') as FormState };
  });
}

/** Forms a rider still has to hand in: required and missing, or sent back for a new copy. */
export function formsToDo(boot: Bootstrap, rider: string): FormToDo[] {
  return formStates(boot.forms || [], boot.submissions || [], rider)
    .filter(f => f.status === 'Needs redo' || (f.status === 'Missing' && f.form.required));
}

export function jobsFor(boot: Bootstrap, name: string, day: Day | undefined, today = isoLocal()): Job[] {
  if (!day || !name) return [];
  const jobs: Job[] = [];
  const next = boot.itinerary.find(d => d.day === day.day + 1);
  if (hasName(day.driver, name)) jobs.push({ kind: 'driver', day });
  if (next && hasName(next.driver, name)) jobs.push({ kind: 'driver-tomorrow', day: next });
  for (const d of [day, next]) if (d && hasName(d.routeLeader, name) && !d.rwgpsLink && !d.restDay) jobs.push({ kind: 'route', day: d });
  for (const duty of boot.duties) if (duty.day === day.day && hasName(duty.person, name)) jobs.push({ kind: 'duty', duty });
  const isNow = day.date === today || (today < (boot.itinerary[0]?.date || '') && day.day === boot.itinerary[0]?.day);
  if (isNow) {
    const todo = formsToDo(boot, name);
    if (todo.length) jobs.push({ kind: 'forms', todo });
  }
  if (isNow) {
    for (const s of boot.stayovers) {
      if (!hasName(s.caller, name)) continue;
      const st = callStatus(boot, s, today);
      if (st.status === 'due' && st.day) jobs.push({ kind: 'call', stayover: s, day: st.day, daysAway: st.daysAway ?? 0 });
    }
  }
  return jobs;
}

export function openJobCount(jobs: Job[]): number {
  return jobs.filter(j => (j.kind === 'duty' ? !j.duty.done : j.kind !== 'driver-tomorrow')).length;
}
