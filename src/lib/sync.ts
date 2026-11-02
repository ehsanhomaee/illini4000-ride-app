// The outbox: everything people add goes here first, so the app works with
// no signal on the road. A loop sends the items to the server as soon as
// there is a connection: small things (check-ins, journals, ticks) first, in
// the order they were made, then files. Big files go up in 1 MB pieces and
// resume where they stopped if the app is closed or the signal drops.

import { ApiError, NetworkError, call, isDemo } from '../api/client';
import type { MediaKind } from '../api/types';
import { getBlob, idb, prefs, putBlob } from './db';
import { newId } from './dates';

interface OpBase {
  id: string;
  label: string;
  user: string; // who was signed in; only their items are sent with their sign-in
  createdAt: number;
  tries: number;
  nextTry?: number;
  error?: string;
}
export interface CallOp extends OpBase {
  type: 'call';
  action: string;
  params: Record<string, unknown>;
}
export interface UploadMeta {
  id: string;
  kind: MediaKind;
  day: number;
  fileName: string;
  mimeType: string;
  size: number;
  caption?: string;
  linkedSheet?: string;
  linkedId?: string;
}
export interface UploadOp extends OpBase {
  type: 'upload';
  meta: UploadMeta;
  offset: number;
  started: boolean;
  needsProbe: boolean;
}
export type Op = CallOp | UploadOp;

const SMALL = 2 * 1024 * 1024; // one request up to this size
const CHUNK = 1024 * 1024; // must be a multiple of 256 KB for Google Drive
const MAX_TRIES = 6;
// Generous time limits sized for one bar of signal (~40 KB/s up).
const timeoutFor = (bytes: number) => 45000 + Math.ceil((bytes * 1.37) / 40000) * 1000;

type Listener = () => void;
const listeners = new Set<Listener>();
let ops: Op[] = [];
let loaded = false;
let running = false;
let paused = false;
let lastError = '';
const progress = new Map<string, number>();
let doneHook: ((op: Op, result: unknown) => void) | null = null;
let authHook: (() => void) | null = null;

export function onOutboxChange(fn: Listener) { listeners.add(fn); return () => { listeners.delete(fn); }; }
function emit() { listeners.forEach(f => f()); }
export function onOpDone(fn: (op: Op, result: unknown) => void) { doneHook = fn; }
export function onAuthLost(fn: () => void) { authHook = fn; }

const currentUser = () => prefs.get<{ name?: string } | null>('me', null)?.name || '';
/** Items waiting to upload for whoever is signed in. */
export function outbox() { const u = currentUser(); return ops.filter(o => o.user === u); }
export function uploadProgress(id: string) { return progress.get(id); }
export function syncState() {
  const mine = outbox();
  return { running, paused, lastError, count: mine.length, failed: mine.filter(o => o.tries >= MAX_TRIES).length, otherUsers: ops.length - mine.length };
}

async function load() {
  if (loaded) return;
  const stored = await idb.all<Op>('outbox');
  const user = currentUser();
  ops = stored.map(o => (o.user === undefined ? { ...o, user } : o)).sort((a, b) => a.createdAt - b.createdAt);
  loaded = true;
  emit();
}
async function persist(op: Op) { await idb.set('outbox', op.id, op); }
function replace(op: Op) { ops = ops.map(o => (o.id === op.id ? op : o)); }
async function drop(op: Op) {
  ops = ops.filter(o => o.id !== op.id);
  await idb.del('outbox', op.id);
  if (op.type === 'upload') await idb.del('blobs', 'up:' + op.id);
  progress.delete(op.id);
  emit();
}

export async function enqueueCall(action: string, params: Record<string, unknown>, label: string): Promise<CallOp> {
  await load();
  const op: CallOp = { id: newId(), type: 'call', action, params, label, user: currentUser(), createdAt: Date.now(), tries: 0 };
  ops = [...ops, op];
  await persist(op);
  emit();
  kick();
  return op;
}

export async function enqueueUpload(file: Blob, meta: Omit<UploadMeta, 'id' | 'size' | 'mimeType'> & { mimeType?: string }, label: string): Promise<UploadOp> {
  await load();
  const id = newId();
  await putBlob('up:' + id, file);
  const op: UploadOp = {
    id, type: 'upload', label, user: currentUser(), offset: 0, started: false, needsProbe: false, createdAt: Date.now(), tries: 0,
    meta: { ...meta, id, size: file.size, mimeType: meta.mimeType || file.type || 'application/octet-stream' },
  };
  ops = [...ops, op];
  await persist(op);
  emit();
  kick();
  return op;
}

export function pendingBlob(op: UploadOp) { return getBlob('up:' + op.id); }

export function setPaused(p: boolean) { paused = p; emit(); if (!p) kick(); }

export async function retry(id: string) {
  const op = ops.find(o => o.id === id);
  if (!op) return;
  const fresh = { ...op, tries: 0, error: undefined, nextTry: undefined } as Op;
  replace(fresh);
  await persist(fresh);
  emit();
  kick();
}
export async function discard(id: string) {
  const op = ops.find(o => o.id === id);
  if (op) await drop(op);
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

async function save(op: UploadOp) { replace(op); await persist(op); }

async function runUpload(op: UploadOp): Promise<unknown> {
  const blob = await getBlob('up:' + op.id);
  if (!blob) throw new ApiError('The file is no longer on this phone.');
  if (isDemo()) return call('demoUpload', { meta: op.meta, blobKey: 'up:' + op.id });

  if (blob.size <= SMALL) {
    progress.set(op.id, 0.3); emit();
    const data = await toBase64(blob);
    return call('upload', { ...op.meta, data }, timeoutFor(blob.size));
  }
  if (!op.started) {
    const r = await call<{ done: boolean; media?: unknown }>('uploadStart', { ...op.meta });
    if (r.done) return r;
    op = { ...op, started: true, offset: 0, needsProbe: false };
    await save(op);
  }
  if (op.needsProbe) {
    const r = await call<{ done: boolean; next?: number; media?: unknown }>('uploadChunk', { id: op.id, probe: true });
    if (r.done) return r;
    op = { ...op, offset: r.next || 0, needsProbe: false };
    await save(op);
  }
  while (op.offset < blob.size) {
    if (paused) throw new NetworkError('Paused');
    progress.set(op.id, op.offset / blob.size); emit();
    const piece = blob.slice(op.offset, Math.min(op.offset + CHUNK, blob.size));
    const data = await toBase64(piece);
    op = { ...op, needsProbe: true }; // if this request dies halfway, ask Drive where it got to
    await save(op);
    const r = await call<{ done: boolean; next?: number; media?: unknown }>('uploadChunk', { id: op.id, offset: op.offset, data }, timeoutFor(piece.size));
    if (r.done) return r;
    op = { ...op, offset: r.next ?? op.offset + piece.size, needsProbe: false };
    await save(op);
  }
  // Every byte sent but Drive has not said "done": ask once more.
  const r = await call<{ done: boolean }>('uploadChunk', { id: op.id, probe: true });
  if (!r.done) { await save({ ...op, started: false, offset: 0 }); throw new NetworkError('Upload incomplete, starting it again.'); }
  return r;
}

async function runOne(op: Op): Promise<unknown> {
  if (op.type === 'upload') return runUpload(op);
  return call(op.action, op.params);
}

export function kick() { void loop(); }

async function loop() {
  await load();
  if (running || paused) return;
  running = true; lastError = ''; emit();
  try {
    // Small items first (in order), then files, so one big video never holds up a check-in.
    const mine = outbox();
    const queue = [...mine.filter(o => o.type === 'call'), ...mine.filter(o => o.type === 'upload')];
    for (const queued of queue) {
      if (paused) break;
      const op = ops.find(o => o.id === queued.id);
      if (!op || op.tries >= MAX_TRIES || (op.nextTry && op.nextTry > Date.now())) continue;
      try {
        const result = await runOne(op);
        progress.delete(op.id);
        doneHook?.(op, result); // before drop(), so the screens never miss it
        await drop(op);
      } catch (e) {
        if (e instanceof NetworkError || (e instanceof ApiError && e.retryable)) { lastError = e.message; break; } // try again later
        if (e instanceof ApiError && e.auth) { lastError = e.message; authHook?.(); break; }
        const latest = ops.find(o => o.id === op.id) || op;
        if (e instanceof ApiError && e.message === 'UPLOAD_EXPIRED' && latest.type === 'upload') {
          await save({ ...latest, started: false, offset: 0, needsProbe: false });
          continue;
        }
        const tries = latest.tries + 1;
        const failed = { ...latest, tries, error: (e as Error).message, nextTry: Date.now() + Math.min(30 * 60000, 15000 * 2 ** tries) } as Op;
        replace(failed);
        await persist(failed);
        lastError = failed.error || '';
        emit();
      }
    }
  } finally {
    running = false;
    emit();
  }
}

// Try again whenever the phone gets signal back or the app comes to the front.
if (typeof window !== 'undefined') {
  window.addEventListener('online', kick);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') kick(); });
  setInterval(() => { if (outbox().length) kick(); }, 30000);
}
