import { useEffect, useRef, useState } from 'react';
import type { Interview, MediaKind } from '../api/types';
import { Icon } from '../components/Icon';
import { InterviewSheet, kindLabel, queueFiles } from '../components/forms';
import { Empty, Field, Tag, TopBar, go, toast } from '../components/ui';
import { fmtDate, fmtDateTime } from '../lib/dates';
import { extFor, fmtSize, keepAwake } from '../lib/media';
import { todayDay, useBoot, useRows, useSession } from '../lib/store';
import { getBlob, idb, putBlob } from '../lib/db';
import { enqueueCall } from '../lib/sync';

const STATUSES = ['Recorded', 'Transcribing', 'Written up', 'Published'];

export function InterviewsScreen() {
  const { data } = useBoot();
  const { rows, loading } = useRows('Interviews');
  const [adding, setAdding] = useState(false);
  if (!data) return null;
  const current = todayDay(data.itinerary);
  return (
    <>
      <TopBar title="Portrait interviews" backTo="/more" right={<button className="iconbtn" aria-label="New interview" onClick={() => setAdding(true)}><Icon name="plus" /></button>} />
      <main className="wrap">
        <p className="muted small" style={{ marginTop: 14 }}>Record the stories of people you meet. Audio, video, photos and the signed release go into one Drive folder per person.</p>
        <button className="btn primary block" onClick={() => setAdding(true)}><Icon name="mic" size={18} />Start a new interview</button>
        {rows.length === 0 && !loading && <Empty icon="mic">No interviews yet.</Empty>}
        <div className="panel" style={{ marginTop: 14 }}>
          <ul className="list">
            {rows.map(iv => (
              <li key={iv.id}>
                <a className="row" href={'#/interview/' + iv.id}>
                  <span className="ic"><Icon name="mic" /></span>
                  <div className="grow">
                    <div className="t">{iv.interviewee}</div>
                    <div className="s">Day {iv.day} · {iv.location} · {iv.interviewers}</div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                      <Tag tone={iv.status === 'Published' ? 'ok' : undefined}>{iv.status || 'Recorded'}</Tag>
                      {!iv.releaseSigned && <Tag tone="warn">No release yet</Tag>}
                    </div>
                  </div>
                  <Icon name="chevR" className="chev" />
                </a>
              </li>
            ))}
          </ul>
        </div>
      </main>
      {adding && <InterviewSheet day={current?.day ?? 1} onClose={() => setAdding(false)} onCreated={id => { setAdding(false); go('/interview/' + id); }} />}
    </>
  );
}

export function InterviewDetail({ id }: { id: string }) {
  const { data } = useBoot();
  const { me } = useSession();
  const { rows } = useRows('Interviews');
  const media = useRows('Media');
  const iv = rows.find(r => r.id === id);
  const [summary, setSummary] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pickKind, setPickKind] = useState<MediaKind>('interview-photo');
  if (!data || !me) return null;
  if (!iv) return <><TopBar title="Interview" backTo="/interviews" /><div className="wrap"><Empty icon="mic">Loading…</Empty></div></>;
  const files = media.rows.filter(m => m.linkedSheet === 'Interviews' && m.linkedId === id);
  const save = async (patch: Partial<Interview>, msg: string) => {
    await enqueueCall('update', { sheet: 'Interviews', id, patch }, 'Interview update');
    toast(msg);
  };
  const pick = (k: MediaKind, accept: string) => {
    setPickKind(k);
    if (fileRef.current) { fileRef.current.accept = accept; fileRef.current.click(); }
  };
  const upload = async (list: File[], kind: MediaKind) => {
    await queueFiles(list, { kind, day: iv.day, caption: `${iv.interviewee} – ${kindLabel(kind)}`, linkedSheet: 'Interviews', linkedId: id });
    toast(`${kindLabel(kind)} saved. Uploading in the background.`);
  };

  return (
    <>
      <TopBar title={iv.interviewee} backTo="/interviews" />
      <main className="wrap">
        <p className="muted" style={{ marginTop: 14 }}>Day {iv.day} · {fmtDate(data.itinerary.find(d => d.day === iv.day)?.date || '')} · {iv.location}<br />With {iv.interviewers}</p>

        <section className="sec">
          <h2>Record</h2>
          <div className="panel"><AudioRecorder storeKey={id} onSave={(blob, ext) => upload([new File([blob], `${iv.interviewee} audio ${new Date().toTimeString().slice(0, 5).replace(':', '')}${ext}`, { type: blob.type })], 'interview-audio')} /></div>
          <div className="quick" style={{ marginTop: 10, gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <button onClick={() => pick('interview-video', 'video/*')}><Icon name="video" />Video</button>
            <button onClick={() => pick('interview-photo', 'image/*')}><Icon name="camera" />Portrait</button>
            <button onClick={() => pick('release-form', 'image/*,application/pdf')}><Icon name="receipt" />Release form</button>
            <button onClick={() => pick('interview-audio', 'audio/*')}><Icon name="mic" />Audio file</button>
          </div>
          <input ref={fileRef} className="hidden-input" type="file" multiple onChange={e => { const f = Array.from(e.target.files || []); e.target.value = ''; if (f.length) void upload(f, pickKind); }} />
          <p className="tiny">Long interview? The phone's own Voice Memos or recorder app is the safest; upload the file here with "Audio file" afterwards.</p>
        </section>

        <section className="sec">
          <h2>Files <span className="aside">{iv.folderUrl && <a href={iv.folderUrl} target="_blank" rel="noreferrer">Open folder</a>}</span></h2>
          <div className="panel">
            {files.length === 0 && <div className="muted" style={{ padding: 16 }}>Nothing recorded yet.</div>}
            <ul className="list">
              {files.map(f => (
                <li key={f.id} className="row">
                  <span className="ic"><Icon name={f.kind === 'interview-audio' ? 'mic' : f.kind === 'interview-video' ? 'video' : f.kind === 'release-form' ? 'receipt' : 'camera'} /></span>
                  <div className="grow"><div className="t">{kindLabel(f.kind)}</div><div className="s">{fmtSize(f.size)} · {fmtDateTime(f.timestamp)} · {f.uploader}</div></div>
                  {f._pending ? <Tag>Uploading</Tag> : f.driveUrl ? <a className="btn small quiet" href={f.driveUrl} target="_blank" rel="noreferrer">Open</a> : <Tag tone="ok">Saved</Tag>}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="sec">
          <h2>Story</h2>
          <div className="panel pad">
            <label className="check" style={{ marginTop: 0 }}>
              <input type="checkbox" checked={!!iv.releaseSigned} onChange={e => void save({ releaseSigned: e.target.checked }, e.target.checked ? 'Release marked as signed.' : 'Release unmarked.')} />
              Release form signed
            </label>
            <Field label="Status">
              <select value={iv.status || 'Recorded'} onChange={e => void save({ status: e.target.value }, 'Status updated.')}>{STATUSES.map(s => <option key={s}>{s}</option>)}</select>
            </Field>
            <Field label="Summary, key quotes, follow-ups">
              <textarea value={summary ?? iv.summary ?? ''} onChange={e => setSummary(e.target.value)} rows={6} />
            </Field>
            {summary !== null && summary !== iv.summary && <button className="btn primary" style={{ marginTop: 10 }} onClick={() => { void save({ summary }, 'Summary saved.'); setSummary(null); }}>Save summary</button>}
            {iv.contact && <p className="small muted" style={{ marginBottom: 0 }}>Contact: {iv.contact}</p>}
          </div>
        </section>
      </main>
    </>
  );
}

function pickMime(): string {
  const MR = (window as Window & { MediaRecorder?: typeof MediaRecorder }).MediaRecorder;
  if (!MR) return '';
  for (const t of ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg']) if (MR.isTypeSupported?.(t)) return t;
  return '';
}

// Each 5-second piece of a recording is saved on the phone as it is made, so
// an interview survives the app being closed or the phone locking.
async function savedPieces(key: string): Promise<string[]> {
  return (await idb.keys('blobs')).map(String).filter(k => k.startsWith(`rec:${key}:`)).sort();
}
async function clearPieces(key: string) {
  for (const k of await savedPieces(key)) await idb.del('blobs', k);
}

function AudioRecorder({ storeKey, onSave }: { storeKey: string; onSave: (blob: Blob, ext: string) => Promise<void> | void }) {
  const [state, setState] = useState<'idle' | 'rec' | 'paused' | 'done'>('idle');
  const [secs, setSecs] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState('');
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const release = useRef<() => void>(() => {});
  const supported = typeof window !== 'undefined' && 'MediaRecorder' in window && !!navigator.mediaDevices?.getUserMedia;

  useEffect(() => {
    if (state !== 'rec') return;
    const t = setInterval(() => setSecs(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [state]);
  useEffect(() => () => { rec.current?.stream.getTracks().forEach(t => t.stop()); release.current(); if (url) URL.revokeObjectURL(url); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Found pieces of a recording that was never saved? Offer them back.
  useEffect(() => {
    let live = true;
    (async () => {
      const keys = await savedPieces(storeKey);
      if (!keys.length || !live || rec.current) return;
      const parts = (await Promise.all(keys.map(k => getBlob(k)))).filter(Boolean) as Blob[];
      const b = new Blob(parts, { type: parts[0]?.type || 'audio/mp4' });
      if (!live || !b.size) return;
      setBlob(b);
      setUrl(URL.createObjectURL(b));
      setState('done');
      toast('Found an unsaved recording from earlier. Save or discard it.');
    })();
    return () => { live = false; };
  }, [storeKey]);

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true } });
      const mime = pickMime();
      const r = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunks.current = [];
      await clearPieces(storeKey);
      let n = 0;
      r.ondataavailable = e => {
        if (!e.data.size) return;
        chunks.current.push(e.data);
        void putBlob(`rec:${storeKey}:${String(n++).padStart(6, '0')}`, e.data);
      };
      r.onstop = () => {
        const b = new Blob(chunks.current, { type: r.mimeType || mime || 'audio/webm' });
        setBlob(b);
        setUrl(URL.createObjectURL(b));
        stream.getTracks().forEach(t => t.stop());
        release.current();
        setState('done');
      };
      r.start(5000);
      rec.current = r;
      release.current = await keepAwake();
      setSecs(0);
      setState('rec');
    } catch {
      toast('Microphone blocked. Allow microphone access for this app in your phone settings.');
    }
  };
  const stop = () => rec.current?.stop();
  const pause = () => { rec.current?.pause(); setState('paused'); };
  const resume = () => { rec.current?.resume(); setState('rec'); };
  const discard = () => { if (url) URL.revokeObjectURL(url); setBlob(null); setUrl(''); setState('idle'); setSecs(0); void clearPieces(storeKey); };
  const save = async () => {
    if (!blob) return;
    await onSave(blob, extFor(blob.type) || '.m4a');
    discard();
  };
  const mmss = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;

  if (!supported) return <div className="pad muted" style={{ padding: 16 }}>This phone can't record audio inside the app. Use the phone's recorder app, then upload with "Audio file" below.</div>;
  return (
    <div>
      <div className="rec">
        {state === 'rec' && <span className="dotlive" />}
        <span className="time">{state === 'idle' ? 'Audio' : mmss}</span>
        {state === 'idle' && <button className="btn danger" onClick={() => void start()}><Icon name="mic" size={18} />Record</button>}
        {state === 'rec' && <><button className="btn" onClick={pause}>Pause</button><button className="btn danger" onClick={stop}>Stop</button></>}
        {state === 'paused' && <><button className="btn" onClick={resume}>Resume</button><button className="btn danger" onClick={stop}>Stop</button></>}
      </div>
      {state === 'done' && url && (
        <div style={{ padding: '0 16px 14px' }}>
          <audio src={url} controls style={{ width: '100%' }} />
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button className="btn" onClick={() => { if (confirm('Delete this recording?')) discard(); }}>Discard</button>
            <button className="btn primary" style={{ flex: 1 }} onClick={() => void save()}>Save recording ({fmtSize(blob?.size || 0)})</button>
          </div>
        </div>
      )}
      {(state === 'rec' || state === 'paused') && <div className="tiny" style={{ padding: '0 16px 12px' }}>Keep the app open while recording. The screen stays on.</div>}
    </div>
  );
}
