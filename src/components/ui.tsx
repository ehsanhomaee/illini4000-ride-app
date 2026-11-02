import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Icon } from './Icon';
import type { Day, Rider } from '../api/types';

// ---------------------------------------------------------------- router --

function readHash() { return window.location.hash.replace(/^#/, '') || '/'; }
const hashStore = {
  subscribe(cb: () => void) { window.addEventListener('hashchange', cb); return () => window.removeEventListener('hashchange', cb); },
  get: readHash,
};
export function useRoute(): { path: string; parts: string[]; query: URLSearchParams } {
  const h = useSyncExternalStore(hashStore.subscribe, hashStore.get);
  const [path, q = ''] = h.split('?');
  return { path, parts: path.split('/').filter(Boolean), query: new URLSearchParams(q) };
}
export function go(path: string) { window.location.hash = path; }
export function back(fallback = '/') {
  if (window.history.length > 1) window.history.back();
  else go(fallback);
}

// ----------------------------------------------------------------- toast --

let toastMsg = '';
let toastTimer: number | undefined;
const toastLs = new Set<() => void>();
export function toast(msg: string) {
  toastMsg = msg;
  toastLs.forEach(f => f());
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { toastMsg = ''; toastLs.forEach(f => f()); }, 3200);
}
export function Toaster() {
  const msg = useSyncExternalStore(cb => { toastLs.add(cb); return () => { toastLs.delete(cb); }; }, () => toastMsg);
  return msg ? <div className="toast" role="status">{msg}</div> : null;
}

// ----------------------------------------------------------------- sheet --

export function Sheet({ title, onClose, children, foot }: { title: string; onClose: () => void; children: ReactNode; foot?: ReactNode }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); };
  }, [onClose]);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-head">
          <h3>{title}</h3>
          <button className="iconbtn" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>
        <div className="sheet-body">{children}</div>
        {foot && <div className="sheet-foot">{foot}</div>}
      </div>
    </>
  );
}

// ------------------------------------------------------------------ bits --

export function TopBar({ title, backTo, right }: { title: string; backTo?: string; right?: ReactNode }) {
  return (
    <header className="topbar">
      <div className="wrap">
        {backTo !== undefined && <button className="iconbtn" aria-label="Back" onClick={() => back(backTo)}><Icon name="chevL" /></button>}
        <h1>{title}</h1>
        {right}
      </div>
    </header>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <div className="hint">{hint}</div>}
    </label>
  );
}

const AV = ['#13294b', '#c2410c', '#1d6f8f', '#6d3fa0', '#17784a', '#9a3412', '#334e7a', '#a1286a'];
export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(s => s[0]?.toUpperCase()).join('');
  return <span className="avatar" style={{ background: AV[h % AV.length], width: size, height: size, fontSize: size * 0.4 }}>{initials || '?'}</span>;
}

export function Empty({ icon = 'more', children }: { icon?: string; children: ReactNode }) {
  return <div className="empty"><Icon name={icon} size={30} /><div style={{ marginTop: 8 }}>{children}</div></div>;
}

export function Spinner() { return <span className="spin" aria-label="Loading" />; }

export function DayChips({ days, value, onChange, allowAll }: { days: Day[]; value: number | 'all'; onChange: (d: number | 'all') => void; allowAll?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current?.querySelector('.chip.on') as HTMLElement | null;
    el?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [value]);
  return (
    <div className="chips" ref={ref}>
      {allowAll && <button className={'chip' + (value === 'all' ? ' on' : '')} onClick={() => onChange('all')}>All days</button>}
      {days.map(d => (
        <button key={d.day} className={'chip' + (value === d.day ? ' on' : '')} onClick={() => onChange(d.day)}>Day {d.day}</button>
      ))}
    </div>
  );
}

export function PersonSelect({ riders, value, onChange, filter, placeholder = 'Choose a person' }: {
  riders: Rider[]; value: string; onChange: (v: string) => void; filter?: (r: Rider) => boolean; placeholder?: string;
}) {
  const list = filter ? riders.filter(filter) : riders;
  return (
    <select value={value} onChange={e => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {list.map(r => <option key={r.name} value={r.name}>{r.name}</option>)}
    </select>
  );
}

/** Submit-button state helper: disables while saving and shows a spinner. */
export function useBusy(): [boolean, <T>(fn: () => Promise<T>) => Promise<T | undefined>] {
  const [busy, setBusy] = useState(false);
  const run = async <T,>(fn: () => Promise<T>) => {
    if (busy) return undefined;
    setBusy(true);
    try { return await fn(); }
    catch (e) { toast((e as Error).message); return undefined; }
    finally { setBusy(false); }
  };
  return [busy, run];
}

export function Tag({ tone, children }: { tone?: 'ok' | 'warn' | 'danger' | 'orange'; children: ReactNode }) {
  return <span className={'tag' + (tone ? ' ' + tone : '')}>{children}</span>;
}
