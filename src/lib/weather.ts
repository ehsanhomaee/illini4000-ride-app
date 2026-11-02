// Forecast from Open-Meteo (free, no key). Cached on the phone so the last
// forecast still shows with no signal.

import type { Day } from '../api/types';
import { idb } from './db';

export interface Forecast {
  date: string;
  highF: number;
  lowF: number;
  rainChance: number;
  rainIn: number;
  windMph: number;
  gustMph: number;
  windFromDeg: number;
  code: number;
  sunrise: string;
  sunset: string;
  place: string;
  fetchedAt: number;
}

const coordCache = new Map<string, { lat: number; lon: number } | null>();

async function geocode(place: string): Promise<{ lat: number; lon: number } | null> {
  const name = place.split(',')[0].trim();
  if (!name) return null;
  if (coordCache.has(place)) return coordCache.get(place)!;
  const cached = await idb.get<{ lat: number; lon: number } | null>('kv', 'geo:' + place);
  if (cached !== undefined) { coordCache.set(place, cached); return cached; }
  const state = (place.split(',')[1] || '').trim().toLowerCase();
  const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=10&countryCode=US&language=en&format=json`);
  const j = await res.json();
  const results: { latitude: number; longitude: number; admin1?: string; admin1_code?: string }[] = j.results || [];
  const pick = results.find(r => state && ((r.admin1 || '').toLowerCase() === state || (STATE_NAMES[state] || '') === (r.admin1 || '').toLowerCase())) || results[0];
  const out = pick ? { lat: pick.latitude, lon: pick.longitude } : null;
  coordCache.set(place, out);
  await idb.set('kv', 'geo:' + place, out);
  return out;
}

export async function coordsFor(day: Day, end: 'start' | 'end'): Promise<{ lat: number; lon: number } | null> {
  const lat = end === 'start' ? day.startLat : day.endLat;
  const lon = end === 'start' ? day.startLon : day.endLon;
  if (lat !== '' && lon !== '' && lat !== undefined && lon !== undefined) return { lat: Number(lat), lon: Number(lon) };
  return geocode(end === 'start' ? day.from : day.to);
}

export async function forecastFor(day: Day, end: 'start' | 'end', cachedOnly = false): Promise<Forecast | null> {
  const key = `wx:${day.date}:${end === 'start' ? day.from : day.to}`;
  const cached = await idb.get<Forecast>('kv', key);
  const fresh = cached && Date.now() - cached.fetchedAt < 60 * 60 * 1000;
  if (cachedOnly || fresh) return cached || null;
  try {
    const c = await coordsFor(day, end);
    if (!c) return cached || null;
    const params = new URLSearchParams({
      latitude: String(c.lat), longitude: String(c.lon),
      daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant,weather_code,sunrise,sunset',
      temperature_unit: 'fahrenheit', wind_speed_unit: 'mph', precipitation_unit: 'inch', timezone: 'auto',
      start_date: day.date, end_date: day.date,
    });
    const res = await fetch('https://api.open-meteo.com/v1/forecast?' + params.toString());
    if (!res.ok) return cached || null; // too far ahead or too far back
    const j = await res.json();
    const d = j.daily;
    if (!d || !d.time?.length) return cached || null;
    const f: Forecast = {
      date: day.date, highF: d.temperature_2m_max[0], lowF: d.temperature_2m_min[0], rainChance: d.precipitation_probability_max[0] ?? 0,
      rainIn: d.precipitation_sum[0] ?? 0, windMph: d.wind_speed_10m_max[0], gustMph: d.wind_gusts_10m_max[0],
      windFromDeg: d.wind_direction_10m_dominant[0], code: d.weather_code[0], sunrise: d.sunrise[0], sunset: d.sunset[0],
      place: end === 'start' ? day.from : day.to, fetchedAt: Date.now(),
    };
    if (f.highF === null || f.highF === undefined) return cached || null;
    await idb.set('kv', key, f);
    return f;
  } catch {
    return cached || null;
  }
}

export function sky(code: number): string {
  if (code === 0) return 'Clear';
  if (code <= 2) return 'Partly cloudy';
  if (code === 3) return 'Cloudy';
  if (code <= 48) return 'Fog';
  if (code <= 57) return 'Drizzle';
  if (code <= 67) return 'Rain';
  if (code <= 77) return 'Snow';
  if (code <= 82) return 'Showers';
  if (code <= 86) return 'Snow showers';
  return 'Thunderstorms';
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export function compass(deg: number) { return COMPASS[Math.round(((deg % 360) + 360) % 360 / 45) % 8]; }

export function bearing(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const toR = Math.PI / 180;
  const y = Math.sin((b.lon - a.lon) * toR) * Math.cos(b.lat * toR);
  const x = Math.cos(a.lat * toR) * Math.sin(b.lat * toR) - Math.sin(a.lat * toR) * Math.cos(b.lat * toR) * Math.cos((b.lon - a.lon) * toR);
  return (Math.atan2(y, x) / toR + 360) % 360;
}

/** Wind direction is where the wind comes FROM. Riding toward it is a headwind. */
export function windFeel(windFromDeg: number, travelDeg: number): 'Headwind' | 'Tailwind' | 'Crosswind' {
  const diff = Math.abs(((windFromDeg - travelDeg + 540) % 360) - 180); // 0 = wind blowing straight at you
  if (diff <= 45) return 'Headwind';
  if (diff >= 135) return 'Tailwind';
  return 'Crosswind';
}

const STATE_NAMES: Record<string, string> = {
  al: 'alabama', ak: 'alaska', az: 'arizona', ar: 'arkansas', ca: 'california', co: 'colorado', ct: 'connecticut', de: 'delaware',
  fl: 'florida', ga: 'georgia', hi: 'hawaii', id: 'idaho', il: 'illinois', in: 'indiana', ia: 'iowa', ks: 'kansas', ky: 'kentucky',
  la: 'louisiana', me: 'maine', md: 'maryland', ma: 'massachusetts', mi: 'michigan', mn: 'minnesota', ms: 'mississippi', mo: 'missouri',
  mt: 'montana', ne: 'nebraska', nv: 'nevada', nh: 'new hampshire', nj: 'new jersey', nm: 'new mexico', ny: 'new york',
  nc: 'north carolina', nd: 'north dakota', oh: 'ohio', ok: 'oklahoma', or: 'oregon', pa: 'pennsylvania', ri: 'rhode island',
  sc: 'south carolina', sd: 'south dakota', tn: 'tennessee', tx: 'texas', ut: 'utah', vt: 'vermont', va: 'virginia', wa: 'washington',
  wv: 'west virginia', wi: 'wisconsin', wy: 'wyoming', dc: 'district of columbia',
};
