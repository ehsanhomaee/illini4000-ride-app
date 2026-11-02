// App-wide state: who is signed in, the itinerary "master" data, and cached
// lists. Everything is cached on the phone so the app opens instantly and
// keeps working without signal.

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ApiError, call, getToken, setToken } from '../api/client';
import { demoMediaUrl } from '../api/demo';
import { isDemo } from '../api/client';
import type { Bootstrap, Day, FormStatus, ListSheet, Media, Rider, SheetRows, Submission } from '../api/types';
import { idb, prefs } from './db';
import { namesIn } from './jobs';
import { isoLocal } from './dates';
import { enqueueCall, kick, onAuthLost, onOpDone, onOutboxChange, outbox, pendingBlob, uploadProgress, type CallOp, type Op } from './sync';

// ------------------------------------------------------------ tiny store --

type Listener = () => void;
function createStore<T>(initial: T) {
  let value = initial;
  const ls = new Set<Listener>();
  return {
    get: () => value,
    set(v: T) { value = v; ls.forEach(l => l()); },
    subscribe(l: Listener) { ls.add(l); return () => { ls.delete(l); }; },
  };
}

export const sessionStore = createStore<{ me: Rider | null }>({ me: prefs.get<Rider | null>('me', null) });
export const bootStore = createStore<{ data: Bootstrap | null; loading: boolean; error: string; fetchedAt: number }>({
  data: null, loading: false, error: '', fetchedAt: 0,
});
const refreshTick = createStore(0);

export function useSession() { return useSyncExternalStore(sessionStore.subscribe, sessionStore.get); }
export function useBoot() { return useSyncExternalStore(bootStore.subscribe, bootStore.get); }
export function useOutbox() {
  const [, force] = useState(0);
  useEffect(() => onOutboxChange(() => force(x => x + 1)), []);
  return outbox();
}

export function signedIn(token: string, me: Rider) {
  setToken(token);
  prefs.set('me', me);
  sessionStore.set({ me });
  void refreshBoot();
  kick();
}

export async function signOut() {
  setToken('');
  prefs.del('me');
  await idb.clear('kv'); // cached lists may hold the last person's private entries
  sessionStore.set({ me: null });
  bootStore.set({ data: null, loading: false, error: '', fetchedAt: 0 });
}

onAuthLost(() => { void signOut(); });

// ------------------------------------------------------------- bootstrap --

/** Older backends and older saved copies may not have every list. */
function normalize(data: Bootstrap): Bootstrap {
  data.forms = data.forms || [];
  data.submissions = data.submissions || [];
  data.duties = data.duties || [];
  return data;
}

export async function loadCachedBoot() {
  const cached = await idb.get<{ data: Bootstrap; at: number }>('kv', 'boot');
  if (cached && !bootStore.get().data) bootStore.set({ ...bootStore.get(), data: normalize(cached.data), fetchedAt: cached.at });
}

let bootSeq = 0;
let masterChangedAt = 0;

export async function refreshBoot() {
  if (!getToken()) return;
  const mine = ++bootSeq;
  const started = Date.now();
  bootStore.set({ ...bootStore.get(), loading: true, error: '' });
  try {
    const data = normalize(await call<Bootstrap>('bootstrap'));
    if (mine !== bootSeq) return; // a newer refresh is on its way
    if (started < masterChangedAt) { bootStore.set({ ...bootStore.get(), loading: false }); scheduleRefresh(); return; } // too old: misses a change that just synced
    applyPendingToBoot(data);
    const at = Date.now();
    await idb.set('kv', 'boot', { data, at });
    prefs.set('me', data.me);
    sessionStore.set({ me: data.me });
    bootStore.set({ data, loading: false, error: '', fetchedAt: at });
  } catch (e) {
    if (e instanceof ApiError && e.auth) { await signOut(); return; }
    if (mine !== bootSeq) return;
    bootStore.set({ ...bootStore.get(), loading: false, error: (e as Error).message });
  }
}

/** Show changes still in the outbox (a ticked stayover, a driver swap) on top of server data. */
function applyPendingToBoot(data: Bootstrap) {
  for (const op of outbox()) if (op.type === 'call') applyCallToBoot(data, op.action, op.params, sessionStore.get().me?.name || '');
}

function applyCallToBoot(data: Bootstrap, action: string, p: Record<string, any>, me: string) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const now = new Date().toISOString();
  if (action === 'confirmStayover') {
    const s = data.stayovers.find(x => x.id === p.id);
    if (s) Object.assign(s, { confirmed: !!p.confirmed, confirmedBy: p.confirmed ? me : '', confirmedAt: p.confirmed ? now : '' }, p.callNotes !== undefined ? { callNotes: p.callNotes } : {});
  } else if (action === 'updateStayover') {
    const s = data.stayovers.find(x => x.id === p.id);
    if (s) Object.assign(s, p.patch);
  } else if (action === 'claimCall') {
    const s = data.stayovers.find(x => x.id === p.id);
    if (s) s.caller = me;
  } else if (action === 'toggleDuty') {
    const d = data.duties.find(x => x.id === p.id);
    if (d) Object.assign(d, { done: !!p.done, doneBy: p.done ? me : '', doneAt: p.done ? now : '' });
  } else if (action === 'add' && p.sheet === 'Submissions') {
    if (p.row.rider === me && !data.submissions.some(x => x.id === p.row.id)) data.submissions.push({ ...p.row, status: 'Submitted' });
  } else if (action === 'reviewForm') {
    const x = data.submissions.find(s => s.id === p.id);
    if (x) Object.assign(x, { status: p.status, note: p.note || '' });
    else if (p.rider === me) data.submissions.push({ ...reviewRow(p, me) });
  } else if (action === 'addDuty') {
    if (!data.duties.find(x => x.id === p.row.id)) data.duties.push({ ...p.row, done: false, doneBy: '', doneAt: '' });
  } else if (action === 'swapDriver') {
    const d = data.itinerary.find(x => x.day === Number(p.day));
    if (d) {
      const names = namesIn(d.driver);
      d.driver = p.replace && names.length > 1
        ? names.map(n => (n.toLowerCase() === String(p.replace).toLowerCase() ? p.toDriver : n)).join(', ')
        : p.toDriver;
    }
  }
}

/** Change master data: shown right away, sent when there is signal. */
export async function mutate(action: string, params: Record<string, unknown>, label: string) {
  const b = bootStore.get();
  if (b.data) {
    const copy: Bootstrap = structuredClone(b.data);
    applyCallToBoot(copy, action, params, sessionStore.get().me?.name || '');
    bootStore.set({ ...b, data: copy });
  }
  await enqueueCall(action, params, label);
}

/** Add a row to one of the logs (journal, gas, donation…). */
export async function addRow<S extends ListSheet>(sheet: S, row: Partial<SheetRows[S]> & { id: string; day: number }, label: string) {
  if (sheet === 'Submissions') {
    const b = bootStore.get();
    if (b.data) {
      const copy: Bootstrap = structuredClone(b.data);
      applyCallToBoot(copy, 'add', { sheet, row }, sessionStore.get().me?.name || '');
      bootStore.set({ ...b, data: copy });
    }
  }
  await enqueueCall('add', { sheet, row }, label);
}

/** The row a leader's review creates when there was no upload (e.g. a paper copy). */
function reviewRow(p: Record<string, any>, me: string): Submission { // eslint-disable-line @typescript-eslint/no-explicit-any
  const now = new Date().toISOString();
  return { id: p.id, timestamp: now, day: 0, rider: p.rider, formId: p.formId, form: p.form || '', status: p.status, note: p.note || '',
    fileLink: '', reviewedBy: me, reviewedAt: now };
}

/** Leaders: approve a form, ask for a new copy, or record a paper copy. */
export async function reviewForm(params: { id: string; status: FormStatus; note?: string; rider?: string; formId?: string; form?: string }, label: string) {
  await enqueueCall('reviewForm', { sheet: 'Submissions', ...params }, label);
}

// Things the server has accepted that the lists have not fetched again yet,
// so nothing blinks out between "sent" and the next refresh.
type Synced = { sheet: string; at: number; row?: Record<string, unknown>; patch?: { id: string; patch: Record<string, unknown> }; removeId?: string };
let synced: Synced[] = [];

onOpDone((op: Op, result: unknown) => {
  const at = Date.now();
  if (op.type === 'upload') {
    const media = (result as { media?: Record<string, unknown> })?.media || (result as Record<string, unknown>);
    if (media && media.id) synced.push({ sheet: 'Media', at, row: media });
  } else if (op.action === 'add') {
    synced.push({ sheet: String(op.params.sheet), at, row: { ...(op.params.row as object), ...(result as object) } });
  } else if (op.action === 'update') {
    synced.push({ sheet: String(op.params.sheet), at, patch: { id: String(op.params.id), patch: op.params.patch as Record<string, unknown> } });
  } else if (op.action === 'remove') {
    synced.push({ sheet: String(op.params.sheet), at, removeId: String(op.params.id) });
  } else if (op.action === 'reviewForm' && result && typeof result === 'object') {
    const row = result as Record<string, unknown>;
    synced.push({ sheet: 'Submissions', at, row, patch: { id: String(row.id), patch: row } });
  } else {
    masterChangedAt = at;
  }
  scheduleRefresh();
});

// One refresh shortly after the last item syncs, instead of one per item.
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
let bootAt = 0;
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTick.set(refreshTick.get() + 1);
    if (masterChangedAt > bootAt) { bootAt = Date.now(); void refreshBoot(); }
  }, 2500);
}

// --------------------------------------------------------------- lists --

// One preview address per file waiting to upload, released once it is uploaded.
const pendingUrls = new Map<string, string>();
async function pendingUrl(op: Op & { type: 'upload' }): Promise<string | undefined> {
  if (pendingUrls.has(op.id)) return pendingUrls.get(op.id);
  const blob = await pendingBlob(op);
  if (!blob) return undefined;
  const url = URL.createObjectURL(blob);
  pendingUrls.set(op.id, url);
  return url;
}
onOutboxChange(() => {
  const live = new Set(outbox().map(o => o.id));
  for (const [id, url] of pendingUrls) if (!live.has(id)) { setTimeout(() => URL.revokeObjectURL(url), 30000); pendingUrls.delete(id); }
});

export function useRows<S extends ListSheet>(sheet: S, day?: number): { rows: SheetRows[S][]; loading: boolean; error: string; reload: () => void } {
  type R = SheetRows[S];
  const key = `list:${sheet}:${day ?? 'all'}`;
  const [server, setServer] = useState<R[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const tick = useSyncExternalStore(refreshTick.subscribe, refreshTick.get);
  const ops = useOutbox();
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let live = true;
    (async () => {
      const cached = await idb.get<R[]>('kv', key);
      if (live && cached) setServer(cached);
      try {
        setLoading(true);
        const started = Date.now();
        const rows = await call<R[]>('list', { sheet, day });
        if (!live) return;
        synced = synced.filter(x => x.sheet !== sheet || x.at >= started);
        setServer(rows);
        setError('');
        await idb.set('kv', key, rows);
      } catch (e) {
        if (live) setError((e as Error).message);
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => { live = false; };
  }, [key, tick, nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  const [pendingMedia, setPendingMedia] = useState<R[]>([]);
  useEffect(() => {
    if (sheet !== 'Media') return;
    let live = true;
    (async () => {
      const out: R[] = [];
      for (const op of ops) {
        if (op.type !== 'upload' || (day !== undefined && op.meta.day !== day)) continue;
        const url = await pendingUrl(op);
        out.push({
          id: op.meta.id, timestamp: new Date(op.createdAt).toISOString(), day: op.meta.day, uploader: sessionStore.get().me?.name || '',
          kind: op.meta.kind, fileName: op.meta.fileName, mimeType: op.meta.mimeType, size: op.meta.size, driveFileId: '', driveUrl: '',
          caption: op.meta.caption || '', linkedSheet: op.meta.linkedSheet || '', linkedId: op.meta.linkedId || '',
          localUrl: url, progress: uploadProgress(op.id) ?? 0, _pending: true,
        } as unknown as R);
      }
      if (live) setPendingMedia(out);
    })();
    return () => { live = false; };
  }, [ops.length, sheet, day]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => {
    const mySynced = synced.filter(x => x.sheet === sheet);
    const base: R[] = [...server];
    for (const x of mySynced) {
      if (x.row && !base.some(r => r.id === x.row!.id) && (day === undefined || Number(x.row.day) === day)) base.push(x.row as unknown as R);
    }
    const goneIds = new Set(mySynced.filter(x => x.removeId).map(x => x.removeId));
    const patched = base.filter(r => !goneIds.has(r.id)).map(r => {
      const ps = mySynced.filter(x => x.patch?.id === r.id);
      return ps.length ? (Object.assign({}, r, ...ps.map(x => x.patch!.patch)) as R) : r;
    });
    const ids = new Set(patched.map(r => r.id));
    const pending: R[] = [];
    for (const op of ops) {
      if (op.type === 'call' && op.action === 'add' && op.params.sheet === sheet) {
        const row = op.params.row as R;
        if (!ids.has(row.id) && (day === undefined || Number(row.day) === day)) pending.push({ ...row, _pending: true });
      }
    }
    const calls = ops.filter((o): o is CallOp => o.type === 'call' && o.params.sheet === sheet);
    const removed = new Set(calls.filter(o => o.action === 'remove').map(o => String(o.params.id)));
    const updates = calls.filter(o => o.action === 'update').map(o => o.params as { id: string; patch: Partial<R> });
    const me = sessionStore.get().me?.name || '';
    for (const o of calls.filter(c => c.action === 'reviewForm')) {
      const p = o.params as Record<string, string>;
      if (ids.has(p.id)) updates.push({ id: p.id, patch: { status: p.status, note: p.note || '', reviewedBy: me, reviewedAt: new Date(o.createdAt).toISOString() } as unknown as Partial<R> });
      else if (!pending.some(r => r.id === p.id)) pending.push({ ...reviewRow(p, me), _pending: true } as unknown as R);
    }
    const merged = [...patched, ...pending, ...(sheet === 'Media' ? pendingMedia.filter(m => !ids.has(m.id)) : [])]
      .filter(r => !removed.has(r.id))
      .map(r => { const u = updates.filter(x => x.id === r.id); return u.length ? Object.assign({}, r, ...u.map(x => x.patch)) : r; });
    return merged.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
  }, [server, ops, pendingMedia, sheet, day]);

  return { rows, loading, error, reload: () => setNonce(n => n + 1) };
}

// ------------------------------------------------------------- helpers --

export function todayDay(itinerary: Day[], today = isoLocal()): Day | undefined {
  if (!itinerary.length) return undefined;
  const exact = itinerary.find(d => d.date === today);
  if (exact) return exact;
  if (today < itinerary[0].date) return itinerary[0];
  return itinerary[itinerary.length - 1];
}

export function thumbUrl(m: Media, width = 600): string | undefined {
  if (m.localUrl) return m.localUrl;
  if (m.driveFileId) return `https://drive.google.com/thumbnail?id=${encodeURIComponent(m.driveFileId)}&sz=w${width}`;
  return undefined;
}

export function useMediaUrl(m: Media, width = 600): string | undefined {
  const [demoUrl, setDemoUrl] = useState<string | undefined>();
  useEffect(() => {
    if (isDemo() && !m.localUrl && !m.driveFileId) void demoMediaUrl(m.id).then(setDemoUrl);
  }, [m.id, m.localUrl, m.driveFileId]);
  return thumbUrl(m, width) || demoUrl;
}

/** "This phone only" journal entries are kept per person, in case a phone is shared. */
export const phoneJournalKey = () => 'phoneJournal:' + (sessionStore.get().me?.name || '');
