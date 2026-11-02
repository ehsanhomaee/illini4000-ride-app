import { useEffect, useMemo, useRef, useState } from 'react';
import type { Media } from '../api/types';
import { Icon } from '../components/Icon';
import { PhotoUploadSheet } from '../components/forms';
import { DayChips, Empty, TopBar, go, toast } from '../components/ui';
import { fmtDate, fmtDateTime } from '../lib/dates';
import { useBoot, useRows, useSession, useMediaUrl, todayDay } from '../lib/store';
import { enqueueCall } from '../lib/sync';
import { Thumb } from './DayScreen';

export function PhotosScreen({ dayParam }: { dayParam: string | null }) {
  const { data } = useBoot();
  const { me } = useSession();
  const current = data ? todayDay(data.itinerary) : undefined;
  const sel: number | 'all' = dayParam === 'all' || !dayParam ? (dayParam === 'all' ? 'all' : current?.day ?? 'all') : Number(dayParam);
  const { rows, loading } = useRows('Media', sel === 'all' ? undefined : sel);
  const [who, setWho] = useState<'all' | 'mine'>('all');
  const [view, setView] = useState<number | null>(null);
  const [files, setFiles] = useState<File[] | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const pics = useMemo(() => rows
    .filter(m => m.kind === 'photo' || m.kind === 'video')
    .filter(m => who === 'all' || m.uploader === me?.name)
    .sort((a, b) => (a.day - b.day) || String(a.timestamp).localeCompare(String(b.timestamp))), [rows, who, me]);
  const byDay = useMemo(() => {
    const g = new Map<number, Media[]>();
    for (const m of pics) g.set(m.day, [...(g.get(m.day) || []), m]);
    return [...g.entries()].sort((a, b) => b[0] - a[0]);
  }, [pics]);
  const flat = byDay.flatMap(([, list]) => list);
  if (!data) return null;
  const dayFor = (n: number) => data.itinerary.find(d => d.day === n);
  const addDay = sel === 'all' ? current?.day ?? 1 : sel;

  return (
    <>
      <TopBar title="Photos" right={<button className="iconbtn" aria-label="Add photos" onClick={() => input.current?.click()}><Icon name="plus" /></button>} />
      <main className="wrap">
        <div style={{ marginTop: 12 }}>
          <DayChips days={data.itinerary} value={sel} allowAll onChange={d => go('/photos?day=' + d)} />
        </div>
        <div className="seg" style={{ marginTop: 8 }}>
          <button className={who === 'all' ? 'on' : ''} onClick={() => setWho('all')}>Everyone's</button>
          <button className={who === 'mine' ? 'on' : ''} onClick={() => setWho('mine')}>Mine</button>
        </div>
        {sel !== 'all' && dayFor(sel) && (
          <p className="muted small" style={{ margin: '12px 0 0' }}>{fmtDate(dayFor(sel)!.date)} · {dayFor(sel)!.from.split(',')[0]} → {dayFor(sel)!.to.split(',')[0]} · {pics.length} {pics.length === 1 ? 'file' : 'files'}</p>
        )}
        {pics.length === 0 && !loading && (
          <Empty icon="camera">
            No photos {sel === 'all' ? 'yet' : `for Day ${sel} yet`}.
            <div><button className="btn primary" onClick={() => input.current?.click()}>Add photos to Day {addDay}</button></div>
          </Empty>
        )}
        {byDay.map(([d, list]) => (
          <div key={d}>
            {sel === 'all' && <div className="dayhead">Day {d} <span>{dayFor(d) ? `${fmtDate(dayFor(d)!.date)} · ${dayFor(d)!.to.split(',')[0]}` : ''} · {list.length}</span></div>}
            <div className="grid" style={sel !== 'all' ? { marginTop: 12 } : undefined}>
              {list.map(m => <Thumb key={m.id} m={m} onClick={() => setView(flat.indexOf(m))} />)}
            </div>
          </div>
        ))}
        {sel !== 'all' && pics.length > 0 && <button className="btn block" style={{ marginTop: 16 }} onClick={() => input.current?.click()}><Icon name="plus" size={18} />Add more to Day {sel}</button>}
      </main>
      <input ref={input} className="hidden-input" type="file" accept="image/*,video/*" multiple
        onChange={e => { const f = Array.from(e.target.files || []); e.target.value = ''; if (f.length) setFiles(f); }} />
      {files && <PhotoUploadSheet day={addDay} initial={files} onClose={() => setFiles(null)} />}
      {view !== null && flat[view] && <Viewer list={flat} index={view} setIndex={setView} canDelete={m => m.uploader === me?.name || me?.role !== 'rider'} />}
    </>
  );
}

function Viewer({ list, index, setIndex, canDelete }: { list: Media[]; index: number; setIndex: (i: number | null) => void; canDelete: (m: Media) => boolean }) {
  const m = list[index];
  const url = useMediaUrl(m, 1600);
  const isVideo = m.mimeType.startsWith('video/');
  const startX = useRef<number | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' && index < list.length - 1) setIndex(index + 1);
      if (e.key === 'ArrowLeft' && index > 0) setIndex(index - 1);
      if (e.key === 'Escape') setIndex(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, list.length, setIndex]);
  const remove = async () => {
    if (!confirm('Delete this file for everyone? It moves to the Drive trash.')) return;
    await enqueueCall('remove', { sheet: 'Media', id: m.id }, 'Delete photo');
    toast('Deleted.');
    setIndex(list.length > 1 ? Math.max(0, index - 1) : null);
  };
  const driveVideo = isVideo && m.driveFileId && !m.localUrl;
  return (
    <div className="viewer" role="dialog" aria-modal="true"
      onTouchStart={e => { startX.current = e.touches[0].clientX; }}
      onTouchEnd={e => {
        if (startX.current === null) return;
        const dx = e.changedTouches[0].clientX - startX.current;
        if (dx < -50 && index < list.length - 1) setIndex(index + 1);
        if (dx > 50 && index > 0) setIndex(index - 1);
        startX.current = null;
      }}>
      <div className="vtop">
        <button className="iconbtn" aria-label="Close" onClick={() => setIndex(null)}><Icon name="x" /></button>
        <div style={{ flex: 1, fontSize: 15 }}>{index + 1} of {list.length} · Day {m.day}</div>
        {m.driveUrl && <a className="iconbtn" href={m.driveUrl} target="_blank" rel="noreferrer" aria-label="Open in Google Drive"><Icon name="external" /></a>}
        {!m._pending && canDelete(m) && <button className="iconbtn" aria-label="Delete" onClick={() => void remove()}><Icon name="trash" /></button>}
      </div>
      <div className="vmain">
        {driveVideo ? (
          <iframe src={`https://drive.google.com/file/d/${m.driveFileId}/preview`} title="Video" allow="autoplay" style={{ width: '100%', height: '100%', border: 0 }} />
        ) : url ? (isVideo ? <video src={url} controls playsInline /> : <img src={url} alt={m.caption || ''} />) : <div style={{ color: '#fff' }}>Preview not available. Open it in Drive.</div>}
      </div>
      <div className="vcap">
        {m.caption && <div style={{ fontWeight: 600 }}>{m.caption}</div>}
        <div style={{ opacity: 0.75 }}>{m.uploader} · {fmtDateTime(m.timestamp)}{m._pending ? ' · waiting to upload' : ''}</div>
      </div>
    </div>
  );
}
