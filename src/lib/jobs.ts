// "Your jobs today": the same rules the backend uses for the morning
// reminder (backend/Code.gs → responsibilitiesFor_).

import type { Bootstrap, Day, Duty, Stayover } from '../api/types';
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
  | { kind: 'call'; stayover: Stayover; day: Day; daysAway: number };

export function jobsFor(boot: Bootstrap, name: string, day: Day | undefined, today = isoLocal()): Job[] {
  if (!day || !name) return [];
  const jobs: Job[] = [];
  const next = boot.itinerary.find(d => d.day === day.day + 1);
  if (hasName(day.driver, name)) jobs.push({ kind: 'driver', day });
  if (next && hasName(next.driver, name)) jobs.push({ kind: 'driver-tomorrow', day: next });
  for (const d of [day, next]) if (d && hasName(d.routeLeader, name) && !d.rwgpsLink && !d.restDay) jobs.push({ kind: 'route', day: d });
  for (const duty of boot.duties) if (duty.day === day.day && hasName(duty.person, name)) jobs.push({ kind: 'duty', duty });
  if (day.date === today || (today < (boot.itinerary[0]?.date || '') && day.day === boot.itinerary[0]?.day)) {
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
