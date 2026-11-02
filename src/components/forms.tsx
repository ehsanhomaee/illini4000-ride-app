// Every "add something" form in the app lives here as a bottom sheet.

import { useEffect, useMemo, useRef, useState } from 'react';
import { call } from '../api/client';
import type { Day, Duty, Journal, MediaKind, Report, ReportCategory, Rider, Stayover } from '../api/types';
import { idb } from '../lib/db';
import { newId } from '../lib/dates';
import { hasName, namesIn } from '../lib/jobs';
import { extFor, fmtPhone, fmtSize, photoName, preparePhoto, telUrl } from '../lib/media';
import { addRow, bootStore, mutate, refreshBoot, sessionStore, phoneJournalKey } from '../lib/store';
import { enqueueCall, enqueueUpload } from '../lib/sync';
import { Icon } from './Icon';
import { Field, PersonSelect, Sheet, toast, useBusy } from './ui';

type Close = { onClose: () => void };
const me = () => sessionStore.get().me?.name || '';
const riders = () => bootStore.get().data?.riders || [];

export async function getPosition(): Promise<{ lat: number; lon: number } | null> {
  if (!('geolocation' in navigator)) return null;
  return new Promise(resolve => {
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: Math.round(p.coords.latitude * 1e5) / 1e5, lon: Math.round(p.coords.longitude * 1e5) / 1e5 }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 120000 },
    );
  });
}

/** Queue files to upload to the right Drive folder. */
export async function queueFiles(files: File[], meta: { kind: MediaKind; day: number; caption?: string; linkedSheet?: string; linkedId?: string }) {
  for (const f of files) {
    const isImage = f.type.startsWith('image/');
    const blob = isImage ? await preparePhoto(f) : f;
    const name = isImage ? photoName(f, blob) : (f.name || 'file' + extFor(f.type));
    const kind: MediaKind = meta.kind === 'photo' && f.type.startsWith('video/') ? 'video' : meta.kind;
    await enqueueUpload(blob, { ...meta, kind, fileName: name, mimeType: blob.type || f.type }, `${kindLabel(kind)}: ${name}`);
  }
}

export function kindLabel(k: MediaKind): string {
  return ({ photo: 'Photo', video: 'Video', receipt: 'Receipt', donation: 'Donation file', 'interview-audio': 'Interview audio',
    'interview-video': 'Interview video', 'interview-photo': 'Interview photo', 'release-form': 'Release form', report: 'Report photo' } as Record<string, string>)[k] || 'File';
}

/** Buttons that open the camera / photo library and show what was picked. */
export function FilePicker({ files, setFiles, accept = 'image/*', camera = true, label = 'Add photo' }: {
  files: File[]; setFiles: (f: File[]) => void; accept?: string; camera?: boolean; label?: string;
}) {
  const lib = useRef<HTMLInputElement>(null);
  const cam = useRef<HTMLInputElement>(null);
  const urls = useMemo(() => files.map(f => (f.type.startsWith('image/') ? URL.createObjectURL(f) : '')), [files]);
  useEffect(() => () => urls.forEach(u => u && URL.revokeObjectURL(u)), [urls]);
  const add = (list: FileList | null) => { if (list?.length) setFiles([...files, ...Array.from(list)]); };
  return (
    <div>
      <div className="pickfile">
        {camera && <button type="button" className="btn small" onClick={() => cam.current?.click()}><Icon name="camera" size={18} />Take photo</button>}
        <button type="button" className="btn small" onClick={() => lib.current?.click()}><Icon name="plus" size={18} />{label}</button>
        <input ref={cam} className="hidden-input" type="file" accept={accept} capture="environment" onChange={e => { add(e.target.files); e.target.value = ''; }} />
        <input ref={lib} className="hidden-input" type="file" accept={accept} multiple onChange={e => { add(e.target.files); e.target.value = ''; }} />
      </div>
      {files.length > 0 && (
        <div className="thumbs">
          {files.map((f, i) => urls[i]
            ? <img key={i} src={urls[i]} alt="" onClick={() => setFiles(files.filter((_, j) => j !== i))} />
            : <div key={i} onClick={() => setFiles(files.filter((_, j) => j !== i))}>{f.type.split('/')[0]}<br />{fmtSize(f.size)}</div>)}
        </div>
      )}
      {files.length > 0 && <div className="tiny" style={{ marginTop: 4 }}>Tap a file to remove it.</div>}
    </div>
  );
}

// ---------------------------------------------------------------- photos --

export function PhotoUploadSheet({ day, initial, onClose }: Close & { day: number; initial: File[] }) {
  const [files, setFiles] = useState<File[]>(initial);
  const [caption, setCaption] = useState('');
  const [busy, run] = useBusy();
  const save = () => run(async () => {
    await queueFiles(files, { kind: 'photo', day, caption });
    toast(`${files.length} ${files.length === 1 ? 'file' : 'files'} added to Day ${day}. Uploading in the background.`);
    onClose();
  });
  return (
    <Sheet title={`Add to Day ${day}`} onClose={onClose}
      foot={<button className="btn primary" disabled={!files.length || busy} onClick={save}>{busy ? 'Preparing…' : `Upload ${files.length || ''}`}</button>}>
      <FilePicker files={files} setFiles={setFiles} accept="image/*,video/*" label="Choose photos or videos" />
      <Field label="Caption (optional)"><input value={caption} onChange={e => setCaption(e.target.value)} placeholder="Where, who, what happened" /></Field>
      <p className="tiny">Photos are saved in the team Drive in this day's folder. Videos upload in pieces, so it is fine to close the app and come back.</p>
    </Sheet>
  );
}

// --------------------------------------------------------------- journal --

const PROMPTS: [string, string][] = [
  ['Rose, bud, thorn', 'Rose: \nBud: \nThorn: '],
  ['Highlight', 'Best moment today: '],
  ['Someone we met', 'Today we met '],
  ['Thank you', 'Grateful for '],
];

export function JournalSheet({ day, entry, onClose }: Close & { day: number; entry?: Journal }) {
  const [visibility, setVisibility] = useState<Journal['visibility']>(entry?.visibility || 'shared');
  const [title, setTitle] = useState(entry?.title || '');
  const [text, setText] = useState(entry?.text || '');
  const [busy, run] = useBusy();
  const save = () => run(async () => {
    const row: Journal = { id: entry?.id || newId(), timestamp: entry?.timestamp || new Date().toISOString(), day, author: me(), visibility, title, text };
    const wasPhone = entry?.visibility === 'phone';
    const wasServer = !!entry && !wasPhone;
    const list = (await idb.get<Journal[]>('local', phoneJournalKey())) || [];
    if (visibility === 'phone') {
      await idb.set('local', phoneJournalKey(), [row, ...list.filter(j => j.id !== row.id)]);
      if (wasServer) await enqueueCall('remove', { sheet: 'Journals', id: row.id }, 'Journal moved to phone');
    } else {
      if (wasPhone) await idb.set('local', phoneJournalKey(), list.filter(j => j.id !== row.id));
      if (wasServer) await mutateRow('Journals', row.id, { visibility, title, text }, 'Journal edit');
      else await addRow('Journals', row, 'Journal entry');
    }
    window.dispatchEvent(new Event('phone-journal'));
    toast(visibility === 'shared' ? 'Shared with the team.' : 'Saved.');
    onClose();
  });
  return (
    <Sheet title={entry ? 'Edit entry' : `Journal · Day ${day}`} onClose={onClose}
      foot={<button className="btn primary" disabled={!text.trim() || busy} onClick={save}>Save entry</button>}>
      <div className="seg" style={{ marginTop: 12 }}>
        <button className={visibility === 'shared' ? 'on' : ''} onClick={() => setVisibility('shared')}>Team</button>
        <button className={visibility === 'private' ? 'on' : ''} onClick={() => setVisibility('private')}>Just me</button>
        <button className={visibility === 'phone' ? 'on' : ''} onClick={() => setVisibility('phone')}>This phone only</button>
      </div>
      <p className="tiny" style={{ marginTop: 6 }}>
        {visibility === 'shared' && 'Everyone on the team can read this.'}
        {visibility === 'private' && 'Only you see this in the app. It is backed up in the team sheet, which trip leaders can open.'}
        {visibility === 'phone' && 'Never leaves this phone. Deleting the app deletes it.'}
      </p>
      {!text && <div className="chips" style={{ marginTop: 6 }}>{PROMPTS.map(([k, v]) => <button key={k} className="chip" onClick={() => { setText(v); if (!title) setTitle(k); }}>{k}</button>)}</div>}
      <Field label="Title (optional)"><input value={title} onChange={e => setTitle(e.target.value)} /></Field>
      <Field label="Entry"><textarea value={text} onChange={e => setText(e.target.value)} rows={8} /></Field>
    </Sheet>
  );
}

async function mutateRow(sheet: string, id: string, patch: Record<string, unknown>, label: string) {
  await enqueueCall('update', { sheet, id, patch }, label);
}

// --------------------------------------------------------------- reports --

const CATEGORIES: ReportCategory[] = ['Route issue', 'Route comment', 'Stayover comment', 'Bike / mechanical', 'Health / injury', 'Van accident', 'Other'];

export function ReportSheet({ day, category: initialCat, onClose }: Close & { day: number; category?: ReportCategory }) {
  const [category, setCategory] = useState<ReportCategory>(initialCat || 'Route issue');
  const [severity, setSeverity] = useState<Report['severity']>(initialCat === 'Van accident' ? 'High' : 'Low');
  const [text, setText] = useState('');
  const [withLoc, setWithLoc] = useState(category === 'Route issue' || category === 'Van accident');
  const [files, setFiles] = useState<File[]>([]);
  const [acc, setAcc] = useState({ when: new Date().toTimeString().slice(0, 5), where: '', driver: '', injuries: 'No', police: '', other: '', insurance: '', damage: '' });
  const boot = bootStore.get().data;
  const dayRow = boot?.itinerary.find(d => d.day === day);
  useEffect(() => { if (category === 'Van accident' && !acc.driver && dayRow) setAcc(a => ({ ...a, driver: namesIn(dayRow.driver)[0] || '' })); }, [category]); // eslint-disable-line react-hooks/exhaustive-deps
  const [busy, run] = useBusy();
  const accident = category === 'Van accident';
  const save = () => run(async () => {
    const pos = withLoc ? await getPosition() : null;
    const details = accident ? [
      `Time: ${acc.when}`, `Where: ${acc.where}`, `Driver: ${acc.driver}`, `Injuries: ${acc.injuries}`, `Police report #: ${acc.police}`,
      `Other party: ${acc.other}`, `Their insurance: ${acc.insurance}`, `Damage: ${acc.damage}`,
    ].join('\n') : '';
    const id = newId();
    await addRow('Reports', { id, timestamp: new Date().toISOString(), day, author: me(), category, severity, text, lat: pos?.lat ?? '', lon: pos?.lon ?? '', details, status: 'Open', resolvedBy: '' }, category);
    if (files.length) await queueFiles(files, { kind: 'report', day, caption: category, linkedSheet: 'Reports', linkedId: id });
    toast(accident ? 'Accident report saved. Leaders are notified when it syncs.' : 'Thanks, report saved.');
    onClose();
  });
  return (
    <Sheet title={accident ? 'Van accident report' : 'Report or comment'} onClose={onClose}
      foot={<button className={'btn ' + (accident ? 'danger' : 'primary')} disabled={!text.trim() || busy} onClick={save}>{busy ? 'Saving…' : 'Save report'}</button>}>
      {accident && (
        <div className="banner danger" style={{ marginTop: 12 }}>
          <Icon name="sos" />
          <div>If anyone is hurt, call 911 first. Move to safety, turn on hazards, then fill this in.
            <div style={{ marginTop: 8 }}><a className="btn small danger" href="tel:911">Call 911</a></div></div>
        </div>
      )}
      <Field label="Type">
        <select value={category} onChange={e => setCategory(e.target.value as ReportCategory)}>
          {CATEGORIES.map(c => <option key={c}>{c}</option>)}
        </select>
      </Field>
      {!accident && (
        <Field label="How important">
          <select value={severity} onChange={e => setSeverity(e.target.value as Report['severity'])}>
            <option>Low</option><option>Medium</option><option>High</option>
          </select>
        </Field>
      )}
      <Field label={accident ? 'What happened' : 'Details'} hint={category === 'Route comment' ? 'Route comments become "notes from previous riders" for next year\'s team.' : undefined}>
        <textarea value={text} onChange={e => setText(e.target.value)} rows={5} />
      </Field>
      {accident && (
        <>
          <div className="two">
            <Field label="Time"><input type="time" value={acc.when} onChange={e => setAcc({ ...acc, when: e.target.value })} /></Field>
            <Field label="Anyone hurt?"><select value={acc.injuries} onChange={e => setAcc({ ...acc, injuries: e.target.value })}><option>No</option><option>Yes</option><option>Not sure</option></select></Field>
          </div>
          <Field label="Where (road, mile marker, town)"><input value={acc.where} onChange={e => setAcc({ ...acc, where: e.target.value })} /></Field>
          <Field label="Van driver"><PersonSelect riders={riders()} value={acc.driver} onChange={v => setAcc({ ...acc, driver: v })} /></Field>
          <Field label="Police report number"><input value={acc.police} onChange={e => setAcc({ ...acc, police: e.target.value })} /></Field>
          <Field label="Other driver: name, phone, plate"><input value={acc.other} onChange={e => setAcc({ ...acc, other: e.target.value })} /></Field>
          <Field label="Their insurance company and policy"><input value={acc.insurance} onChange={e => setAcc({ ...acc, insurance: e.target.value })} /></Field>
          <Field label="Damage to the van"><input value={acc.damage} onChange={e => setAcc({ ...acc, damage: e.target.value })} /></Field>
        </>
      )}
      <label className="check"><input type="checkbox" checked={withLoc} onChange={e => setWithLoc(e.target.checked)} />Attach my current location</label>
      <FilePicker files={files} setFiles={setFiles} label={accident ? 'Add photos of damage, plates, insurance card' : 'Add photo'} />
    </Sheet>
  );
}

// ------------------------------------------------------------------- gas --

const PAID = ['Team card', 'Cash', 'Paid myself (reimburse me)'];

export function GasSheet({ day, onClose }: Close & { day: number }) {
  const boot = bootStore.get().data;
  const d = boot?.itinerary.find(x => x.day === day);
  const defaultDriver = d && hasName(d.driver, me()) ? me() : namesIn(d?.driver || '')[0] || me();
  const [driver, setDriver] = useState(defaultDriver);
  const [gallons, setGallons] = useState('');
  const [price, setPrice] = useState('');
  const [total, setTotal] = useState('');
  const [odo, setOdo] = useState('');
  const [station, setStation] = useState('');
  const [paidWith, setPaidWith] = useState(PAID[0]);
  const [notes, setNotes] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const auto = gallons && price ? (Number(gallons) * Number(price)).toFixed(2) : '';
  const [busy, run] = useBusy();
  const save = () => run(async () => {
    const id = newId();
    const t = Number(total || auto);
    await addRow('Gas', { id, timestamp: new Date().toISOString(), day, driver, gallons: Number(gallons), pricePerGallon: Number(price), total: t,
      odometer: odo ? Number(odo) : '', station, paidWith, notes, receiptLink: '' }, 'Gas fill-up');
    if (files.length) await queueFiles(files, { kind: 'receipt', day, caption: `Gas $${t.toFixed(2)}`, linkedSheet: 'Gas', linkedId: id });
    toast('Gas logged.');
    onClose();
  });
  return (
    <Sheet title="Log gas" onClose={onClose}
      foot={<button className="btn primary" disabled={!gallons || !(total || auto) || busy} onClick={save}>Save fill-up</button>}>
      <Field label="Driver"><PersonSelect riders={riders()} value={driver} onChange={setDriver} /></Field>
      <div className="two">
        <Field label="Gallons"><input inputMode="decimal" value={gallons} onChange={e => setGallons(e.target.value)} placeholder="18.4" /></Field>
        <Field label="Price per gallon"><input inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} placeholder="3.49" /></Field>
      </div>
      <div className="two">
        <Field label="Total paid" hint={auto && !total ? `Will save $${auto}` : undefined}><input inputMode="decimal" value={total} onChange={e => setTotal(e.target.value)} placeholder={auto || '0.00'} /></Field>
        <Field label="Odometer"><input inputMode="numeric" value={odo} onChange={e => setOdo(e.target.value)} /></Field>
      </div>
      <Field label="Station and town"><input value={station} onChange={e => setStation(e.target.value)} /></Field>
      <Field label="Paid with"><select value={paidWith} onChange={e => setPaidWith(e.target.value)}>{PAID.map(p => <option key={p}>{p}</option>)}</select></Field>
      <Field label="Notes"><input value={notes} onChange={e => setNotes(e.target.value)} /></Field>
      <FilePicker files={files} setFiles={setFiles} label="Receipt from library" />
      <p className="tiny">Receipt photos go to the Receipts folder in Drive.</p>
    </Sheet>
  );
}

// -------------------------------------------------------------- receipts --

const EXPENSE_CATS = ['Food', 'Bike parts / repair', 'Van (not gas)', 'Lodging', 'Supplies', 'Medical', 'Other'];

export function ExpenseSheet({ day, onClose }: Close & { day: number }) {
  const [amount, setAmount] = useState('');
  const [vendor, setVendor] = useState('');
  const [category, setCategory] = useState(EXPENSE_CATS[0]);
  const [paidWith, setPaidWith] = useState(PAID[0]);
  const [reimburseTo, setReimburseTo] = useState('');
  const [notes, setNotes] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, run] = useBusy();
  const save = () => run(async () => {
    const id = newId();
    await addRow('Expenses', { id, timestamp: new Date().toISOString(), day, recordedBy: me(), amount: Number(amount), vendor, category, paidWith,
      reimburseTo: paidWith.startsWith('Paid myself') ? reimburseTo || me() : '', notes, receiptLink: '' }, 'Receipt');
    if (files.length) await queueFiles(files, { kind: 'receipt', day, caption: `${category} $${Number(amount).toFixed(2)} ${vendor}`, linkedSheet: 'Expenses', linkedId: id });
    toast('Receipt saved.');
    onClose();
  });
  return (
    <Sheet title="Add a receipt" onClose={onClose}
      foot={<button className="btn primary" disabled={!amount || busy} onClick={save}>Save receipt</button>}>
      <FilePicker files={files} setFiles={setFiles} label="Receipt from library" />
      <div className="two">
        <Field label="Amount"><input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" /></Field>
        <Field label="Category"><select value={category} onChange={e => setCategory(e.target.value)}>{EXPENSE_CATS.map(c => <option key={c}>{c}</option>)}</select></Field>
      </div>
      <Field label="Store or vendor"><input value={vendor} onChange={e => setVendor(e.target.value)} /></Field>
      <Field label="Paid with"><select value={paidWith} onChange={e => setPaidWith(e.target.value)}>{PAID.map(p => <option key={p}>{p}</option>)}</select></Field>
      {paidWith.startsWith('Paid myself') && <Field label="Reimburse"><PersonSelect riders={riders()} value={reimburseTo || me()} onChange={setReimburseTo} /></Field>}
      <Field label="What was it for"><input value={notes} onChange={e => setNotes(e.target.value)} /></Field>
    </Sheet>
  );
}

// ------------------------------------------------------------- donations --

const DONATION_TYPES = ['Cash', 'Check', 'Online / Venmo', 'Food / meal', 'Lodging', 'In-kind (gear, services)', 'Other'];

export function DonationSheet({ day, onClose }: Close & { day: number }) {
  const [donor, setDonor] = useState('');
  const [contact, setContact] = useState('');
  const [type, setType] = useState(DONATION_TYPES[0]);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [thanked, setThanked] = useState(false);
  const [notes, setNotes] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, run] = useBusy();
  const save = () => run(async () => {
    const id = newId();
    await addRow('Donations', { id, timestamp: new Date().toISOString(), day, recordedBy: me(), donor, donorContact: contact, type,
      amount: amount ? Number(amount) : '', description, thankYouSent: thanked, notes, fileLink: '' }, 'Donation');
    if (files.length) await queueFiles(files, { kind: 'donation', day, caption: `${type} ${donor}`, linkedSheet: 'Donations', linkedId: id });
    toast('Donation recorded. Remember the thank-you note!');
    onClose();
  });
  return (
    <Sheet title="Record a donation" onClose={onClose}
      foot={<button className="btn primary" disabled={!donor.trim() || busy} onClick={save}>Save donation</button>}>
      <Field label="From (person, business or group)"><input value={donor} onChange={e => setDonor(e.target.value)} /></Field>
      <Field label="Their contact for a thank-you" hint="Email, phone or mailing address"><input value={contact} onChange={e => setContact(e.target.value)} /></Field>
      <div className="two">
        <Field label="Type"><select value={type} onChange={e => setType(e.target.value)}>{DONATION_TYPES.map(c => <option key={c}>{c}</option>)}</select></Field>
        <Field label="Amount ($)" hint="Estimate for food or gear"><input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} /></Field>
      </div>
      <Field label="What was given"><input value={description} onChange={e => setDescription(e.target.value)} placeholder="Dinner for 30, $200 check, 4 inner tubes…" /></Field>
      <label className="check"><input type="checkbox" checked={thanked} onChange={e => setThanked(e.target.checked)} />Thank-you already sent</label>
      <Field label="Notes"><input value={notes} onChange={e => setNotes(e.target.value)} /></Field>
      <FilePicker files={files} setFiles={setFiles} label="Photo of check or note" />
      <p className="tiny">Files go to the Donations folder in Drive, separate from receipts.</p>
    </Sheet>
  );
}

// ------------------------------------------------------------ interviews --

export function InterviewSheet({ day, onClose, onCreated }: Close & { day: number; onCreated: (id: string) => void }) {
  const [interviewers, setInterviewers] = useState(me());
  const [interviewee, setInterviewee] = useState('');
  const [location, setLocation] = useState(bootStore.get().data?.itinerary.find(d => d.day === day)?.to || '');
  const [contact, setContact] = useState('');
  const [release, setRelease] = useState(false);
  const [busy, run] = useBusy();
  const save = () => run(async () => {
    const id = newId();
    await addRow('Interviews', { id, timestamp: new Date().toISOString(), day, interviewers, interviewee, location, contact, releaseSigned: release,
      summary: '', status: 'Recorded', folderUrl: '' }, 'Portrait interview');
    onCreated(id);
  });
  return (
    <Sheet title="New portrait interview" onClose={onClose}
      foot={<button className="btn primary" disabled={!interviewee.trim() || busy} onClick={save}>Start interview</button>}>
      <Field label="Who are you interviewing?"><input value={interviewee} onChange={e => setInterviewee(e.target.value)} /></Field>
      <Field label="Interviewers" hint="Separate names with commas"><input value={interviewers} onChange={e => setInterviewers(e.target.value)} /></Field>
      <Field label="Where"><input value={location} onChange={e => setLocation(e.target.value)} /></Field>
      <Field label="Their contact (to share the published story)"><input value={contact} onChange={e => setContact(e.target.value)} /></Field>
      <label className="check"><input type="checkbox" checked={release} onChange={e => setRelease(e.target.checked)} />Release form signed</label>
      <p className="tiny">Next you can record audio, take video and photos, and snap the release form. Everything goes into one folder for this person in Drive.</p>
    </Sheet>
  );
}

// ---------------------------------------------------------------- driver --

export function SwapDriverSheet({ day, onClose }: Close & { day: Day }) {
  const current = namesIn(day.driver);
  const [replace, setReplace] = useState(current.find(n => n.toLowerCase() === me().toLowerCase()) || current[0] || '');
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [busy, run] = useBusy();
  const save = () => run(async () => {
    await mutate('swapDriver', { id: newId(), day: day.day, toDriver: to, replace: current.length > 1 ? replace : undefined, reason }, `Driver for Day ${day.day}`);
    toast(`${to} is driving Day ${day.day}. They get a notification.`);
    onClose();
  });
  const pool = riders();
  return (
    <Sheet title={`Change driver · Day ${day.day}`} onClose={onClose}
      foot={<button className="btn primary" disabled={!to || busy} onClick={save}>Change driver</button>}>
      <p className="muted" style={{ marginTop: 12 }}>Now driving: <b>{day.driver || 'nobody yet'}</b></p>
      {current.length > 1 && (
        <Field label="Replace"><select value={replace} onChange={e => setReplace(e.target.value)}>{current.map(n => <option key={n}>{n}</option>)}</select></Field>
      )}
      <Field label="New driver" hint="Only people marked as van drivers are listed.">
        <PersonSelect riders={pool} value={to} onChange={setTo} filter={(r: Rider) => r.canDrive && !current.includes(r.name)} />
      </Field>
      <Field label="Reason (optional)"><input value={reason} onChange={e => setReason(e.target.value)} placeholder="Traded with Sam, sore knee…" /></Field>
    </Sheet>
  );
}

// -------------------------------------------------------------- stayover --

export function StayoverCallSheet({ stayover, dayLabel, onClose }: Close & { stayover: Stayover; dayLabel: string }) {
  const [notes, setNotes] = useState(stayover.callNotes || '');
  const [busy, run] = useBusy();
  const save = (confirmed: boolean) => run(async () => {
    await mutate('confirmStayover', { id: stayover.id, confirmed, callNotes: notes }, `Stayover ${stayover.name}`);
    toast(confirmed ? `${stayover.name} marked confirmed.` : 'Notes saved.');
    onClose();
  });
  return (
    <Sheet title="Confirm stayover" onClose={onClose}
      foot={<>
        <button className="btn" disabled={busy} onClick={() => save(stayover.confirmed)}>Save notes</button>
        <button className="btn ok" disabled={busy} onClick={() => save(true)}><Icon name="check" size={18} />Confirmed</button>
      </>}>
      <div style={{ marginTop: 12 }}>
        <div className="h2" style={{ marginBottom: 2 }}>{stayover.name}</div>
        <div className="muted small">{dayLabel}</div>
      </div>
      {stayover.contactPhone ? (
        <a className="btn primary block" style={{ marginTop: 14 }} href={telUrl(stayover.contactPhone)}>
          <Icon name="phone" size={18} />Call {stayover.contactName || 'host'} · {fmtPhone(stayover.contactPhone)}
        </a>
      ) : <div className="banner" style={{ marginTop: 14 }}>No phone number in the sheet yet. {stayover.contactEmail && `Email: ${stayover.contactEmail}`}</div>}
      <Field label="Call notes" hint="Arrival time, what they are providing, any changes."><textarea value={notes} onChange={e => setNotes(e.target.value)} rows={5} /></Field>
      {stayover.confirmed && <button className="btn small" style={{ marginTop: 10 }} disabled={busy} onClick={() => save(false)}>Mark as not confirmed</button>}
    </Sheet>
  );
}

const STAY_FIELDS: [keyof Stayover, string][] = [
  ['checkInTime', 'Check-in time'], ['checkOutTime', 'Check-out time'], ['dinner', 'Dinner'], ['breakfast', 'Breakfast'], ['lunch', 'Lunch'],
  ['showers', 'Showers'], ['laundry', 'Laundry'], ['sleeping', 'Sleeping'], ['wifi', 'WiFi'], ['vanParking', 'Van parking'],
  ['address', 'Address'], ['contactName', 'Contact name'], ['contactPhone', 'Contact phone'], ['contactEmail', 'Contact email'], ['notes', 'Notes'],
];

export function StayoverEditSheet({ stayover, onClose }: Close & { stayover: Stayover }) {
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(STAY_FIELDS.map(([k]) => [k, String(stayover[k] ?? '')])));
  const [busy, run] = useBusy();
  const save = () => run(async () => {
    const patch: Record<string, string> = {};
    for (const [k] of STAY_FIELDS) if (vals[k] !== String(stayover[k] ?? '')) patch[k] = vals[k];
    if (Object.keys(patch).length) await mutate('updateStayover', { id: stayover.id, patch }, `Stayover ${stayover.name}`);
    toast('Stayover updated.');
    onClose();
  });
  return (
    <Sheet title="Edit stayover info" onClose={onClose} foot={<button className="btn primary" disabled={busy} onClick={save}>Save changes</button>}>
      {STAY_FIELDS.map(([k, label]) => (
        <Field key={k} label={label}>
          {k === 'notes' ? <textarea value={vals[k]} onChange={e => setVals({ ...vals, [k]: e.target.value })} rows={4} />
            : <input value={vals[k]} onChange={e => setVals({ ...vals, [k]: e.target.value })} />}
        </Field>
      ))}
    </Sheet>
  );
}

// ----------------------------------------------------------------- route --

export function RouteSheet({ day, onClose }: Close & { day: Day }) {
  const [link, setLink] = useState(day.rwgpsLink);
  const [miles, setMiles] = useState(String(day.plannedMiles ?? ''));
  const [busy, run] = useBusy();
  const save = () => run(async () => {
    const r = await call<{ warning?: string }>('setRoute', { day: day.day, rwgpsLink: link.trim(), plannedMiles: miles }, 90000);
    await refreshBoot();
    toast(r.warning || 'Route saved. Miles and climbing updated from RideWithGPS.');
    onClose();
  });
  return (
    <Sheet title={`Route · Day ${day.day}`} onClose={onClose} foot={<button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Reading route…' : 'Save route'}</button>}>
      <Field label="RideWithGPS link" hint="Paste the share link, e.g. ridewithgps.com/routes/123456. The route must be public or unlisted.">
        <input value={link} onChange={e => setLink(e.target.value)} inputMode="url" placeholder="https://ridewithgps.com/routes/…" />
      </Field>
      <Field label="Planned miles" hint="Rough estimate shown until the route is added.">
        <input inputMode="decimal" value={miles} onChange={e => setMiles(e.target.value)} />
      </Field>
      <p className="tiny">Needs signal: the server reads the distance and climbing from RideWithGPS right away.</p>
    </Sheet>
  );
}

// ------------------------------------------------------------------ jobs --

export function DutySheet({ day, onClose }: Close & { day: number }) {
  const [person, setPerson] = useState('');
  const [duty, setDuty] = useState('');
  const [details, setDetails] = useState('');
  const [busy, run] = useBusy();
  const save = () => run(async () => {
    const row: Duty = { id: newId(), day, person, duty, details, done: false, doneBy: '', doneAt: '' };
    await mutate('addDuty', { row }, `Job for ${person}`);
    toast(`Job added for ${person}.`);
    onClose();
  });
  return (
    <Sheet title={`Add a job · Day ${day}`} onClose={onClose} foot={<button className="btn primary" disabled={!person || !duty || busy} onClick={save}>Add job</button>}>
      <Field label="Who">
        <select value={person} onChange={e => setPerson(e.target.value)}>
          <option value="">Choose</option><option>Everyone</option>
          {riders().map(r => <option key={r.name}>{r.name}</option>)}
        </select>
      </Field>
      <Field label="Job"><input value={duty} onChange={e => setDuty(e.target.value)} placeholder="Blog post, sweep, lunch stop, thank-you card…" /></Field>
      <Field label="Details (optional)"><input value={details} onChange={e => setDetails(e.target.value)} /></Field>
      <p className="tiny">Leaders can also fill the Duties tab in the sheet for the whole trip.</p>
    </Sheet>
  );
}

