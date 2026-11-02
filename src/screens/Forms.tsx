// Rider forms: waivers, media releases, insurance cards and the like.
// Leaders list the forms in the sheet's Forms tab. Each rider uploads a
// photo or PDF of theirs; leaders approve it or ask for a new copy.

import { useMemo, useState } from 'react';
import type { FormReq, Media, Submission } from '../api/types';
import { Icon } from '../components/Icon';
import { FilePicker, queueFiles } from '../components/forms';
import { Avatar, Field, Sheet, Tag, TopBar, go, toast, useBusy } from '../components/ui';
import { fmtDate, newId } from '../lib/dates';
import { formStates, type FormState, type FormToDo } from '../lib/jobs';
import { fmtSize } from '../lib/media';
import { addRow, reviewForm, todayDay, useBoot, useMediaUrl, useRows, useSession } from '../lib/store';

const TONE: Record<FormState, 'ok' | 'warn' | 'danger' | undefined> = { Approved: 'ok', Submitted: undefined, 'Needs redo': 'danger', Missing: 'warn' };
const LABEL: Record<FormState, string> = { Approved: 'Approved', Submitted: 'Waiting for review', 'Needs redo': 'Needs a new copy', Missing: 'Not handed in' };
const toneFor = (s: FormToDo) => (s.status === 'Missing' && !s.form.required ? undefined : TONE[s.status]);
const fileCount = (n: number) => (n === 0 ? 'no files' : n === 1 ? '1 file' : `${n} files`);

export function FormsScreen({ tab: initial }: { tab?: string }) {
  const { data } = useBoot();
  const { me } = useSession();
  const [upload, setUpload] = useState<FormReq | null>(null);
  if (!data || !me) return null;
  const leader = me.role !== 'rider';
  const tab = leader && initial === 'team' ? 'team' : 'mine';

  return (
    <>
      <TopBar title="Forms" backTo="/more" />
      <main className="wrap">
        {leader && (
          <div className="seg" style={{ marginTop: 16 }}>
            <button className={tab === 'mine' ? 'on' : ''} onClick={() => go('/forms')}>My forms</button>
            <button className={tab === 'team' ? 'on' : ''} onClick={() => go('/forms/team')}>Team</button>
          </div>
        )}
        {tab === 'mine' ? <MyForms forms={data.forms} subs={data.submissions} me={me.name} onUpload={setUpload} /> : <TeamForms />}
      </main>
      {upload && <FormUploadSheet form={upload} onClose={() => setUpload(null)} />}
    </>
  );
}

// ------------------------------------------------------------- my forms --

function MyForms({ forms, subs, me, onUpload }: { forms: FormReq[]; subs: Submission[]; me: string; onUpload: (f: FormReq) => void }) {
  const states = formStates(forms, subs, me);
  const required = states.filter(s => s.form.required);
  const todo = states.filter(s => s.status === 'Needs redo' || (s.status === 'Missing' && s.form.required));
  const media = useRows('Media');
  if (!forms.length) return <p className="muted" style={{ marginTop: 16 }}>No forms to hand in yet. Leaders list them in the Forms tab of the team sheet.</p>;
  return (
    <>
      <div className={'banner' + (todo.length ? '' : ' ok')} style={{ marginTop: 16 }}>
        <Icon name={todo.length ? 'receipt' : 'check'} />
        <div>{todo.length
          ? `${todo.length} ${todo.length === 1 ? 'form' : 'forms'} to hand in. Take a photo of each page or upload a PDF.`
          : `All ${required.length} required forms are in. Thanks!`}</div>
      </div>
      <div className="panel" style={{ marginTop: 14 }}>
        {states.map(s => {
          const files = s.last ? media.rows.filter(m => m.linkedSheet === 'Submissions' && m.linkedId === s.last!.id) : [];
          return (
            <div key={s.form.id} className="entry">
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="title" style={{ marginTop: 0 }}>{s.form.form} {!s.form.required && <Tag>Optional</Tag>}</div>
                  {s.form.description && <div className="small muted">{s.form.description}</div>}
                </div>
                <Tag tone={toneFor(s)}>{LABEL[s.status]}</Tag>
              </div>
              <StatusLine s={s} files={files} />
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                {s.status !== 'Approved' && (
                  <button className={'btn small' + (s.status === 'Missing' || s.status === 'Needs redo' ? ' primary' : '')} onClick={() => onUpload(s.form)}>
                    <Icon name="camera" size={16} />{s.status === 'Missing' ? 'Upload' : 'Upload a new copy'}
                  </button>
                )}
                {s.form.templateLink && <a className="btn small quiet" href={s.form.templateLink} target="_blank" rel="noreferrer"><Icon name="download" size={16} />Blank form</a>}
              </div>
            </div>
          );
        })}
      </div>
      <p className="tiny" style={{ marginTop: 10 }}>Your forms go to a private Drive folder only trip leaders can open. Other riders can't see them.</p>
    </>
  );
}

function StatusLine({ s, files }: { s: FormToDo; files: Media[] }) {
  const l = s.last;
  const due = s.form.dueDate && s.status === 'Missing' ? ` Due ${fmtDate(s.form.dueDate)}.` : '';
  let text = '';
  if (!l) text = `Not handed in yet.${due}`;
  else if (s.status === 'Submitted') text = `Sent ${fmtDate(l.timestamp.slice(0, 10))}${files.length ? ` · ${fileCount(files.length)}` : ''}. A leader will check it.`;
  else if (s.status === 'Approved') text = `Approved by ${l.reviewedBy || 'a leader'}${l.note ? ` · ${l.note}` : ''}.`;
  else text = `${l.reviewedBy || 'A leader'} asked for a new copy${l.note ? `: ${l.note}` : '.'}`;
  const uploading = files.some(f => f._pending);
  return <div className="small" style={{ marginTop: 6, color: s.status === 'Needs redo' ? 'var(--danger)' : 'var(--ink-2)' }}>{text}{uploading ? ' Uploading…' : ''}</div>;
}

export function FormUploadSheet({ form, onClose }: { form: FormReq; onClose: () => void }) {
  const { data } = useBoot();
  const { me } = useSession();
  const [files, setFiles] = useState<File[]>([]);
  const [note, setNote] = useState('');
  const [busy, run] = useBusy();
  const day = data ? todayDay(data.itinerary)?.day ?? 0 : 0;
  const save = () => run(async () => {
    const id = newId();
    await addRow('Submissions', { id, timestamp: new Date().toISOString(), day, rider: me?.name || '', formId: form.id, form: form.form,
      status: 'Submitted', note, fileLink: '', reviewedBy: '', reviewedAt: '' }, form.form);
    await queueFiles(files, { kind: 'rider-form', day, caption: form.form, linkedSheet: 'Submissions', linkedId: id });
    toast(`${form.form} sent. A leader will check it.`);
    onClose();
  });
  return (
    <Sheet title={form.form} onClose={onClose}
      foot={<button className="btn primary" disabled={!files.length || busy} onClick={save}>{busy ? 'Preparing…' : 'Send to leaders'}</button>}>
      {form.description && <p className="muted" style={{ marginTop: 12 }}>{form.description}</p>}
      {form.templateLink && <a className="btn small quiet" href={form.templateLink} target="_blank" rel="noreferrer"><Icon name="download" size={16} />Get the blank form</a>}
      <FilePicker files={files} setFiles={setFiles} accept="image/*,application/pdf" label="Choose photo or PDF" />
      <p className="tiny">Take one photo per page in good light, flat on a table. For a card, add the front and the back.</p>
      <Field label="Note for the leaders (optional)"><input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. second photo is the back of the card" /></Field>
    </Sheet>
  );
}

// ------------------------------------------------------------ team forms --

function TeamForms() {
  const { data } = useBoot();
  const subs = useRows('Submissions');
  const media = useRows('Media');
  const [open, setOpen] = useState<string | null>(null);
  const [review, setReview] = useState<{ rider: string; s: FormToDo } | null>(null);
  const riders = useMemo(() => [...(data?.riders || [])].sort((a, b) => a.name.localeCompare(b.name)), [data]);
  if (!data) return null;
  const forms = data.forms;
  const byRider = new Map(riders.map(r => [r.name, formStates(forms, subs.rows, r.name)]));
  const waiting = [...byRider.entries()].flatMap(([rider, st]) => st.filter(s => s.status === 'Submitted').map(s => ({ rider, s })))
    .sort((a, b) => String(a.s.last?.timestamp).localeCompare(String(b.s.last?.timestamp)));
  const filesFor = (s?: Submission) => (s ? media.rows.filter(m => m.linkedSheet === 'Submissions' && m.linkedId === s.id) : []);

  return (
    <>
      <section className="sec">
        <h2>Progress</h2>
        <div className="panel">
          <ul className="list">
            {forms.map(f => {
              const all = riders.map(r => byRider.get(r.name)!.find(x => x.form.id === f.id)!);
              const ok = all.filter(x => x.status === 'Approved').length;
              const wait = all.filter(x => x.status === 'Submitted').length;
              return (
                <li key={f.id} className="row">
                  <div className="grow">
                    <div className="t">{f.form} {!f.required && <Tag>Optional</Tag>}</div>
                    <div className="s">{ok} of {riders.length} approved{wait ? ` · ${wait} waiting` : ''}{f.dueDate ? ` · due ${fmtDate(f.dueDate)}` : ''}</div>
                  </div>
                  <Tag tone={ok === riders.length ? 'ok' : undefined}>{Math.round((ok / Math.max(1, riders.length)) * 100)}%</Tag>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      <section className="sec">
        <h2>Waiting for review <span className="aside">{waiting.length}</span></h2>
        <div className="panel">
          {waiting.length === 0 && <div className="muted" style={{ padding: 16 }}>Nothing to check right now.</div>}
          <ul className="list">
            {waiting.map(({ rider, s }) => (
              <li key={s.last!.id}>
                <button className="row" onClick={() => setReview({ rider, s })}>
                  <Avatar name={rider} />
                  <div className="grow"><div className="t">{rider}</div><div className="s">{s.form.form} · sent {fmtDate(s.last!.timestamp.slice(0, 10))} · {fileCount(filesFor(s.last).length)}</div></div>
                  <Icon name="chevR" className="chev" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="sec">
        <h2>By rider</h2>
        <div className="panel">
          <ul className="list">
            {riders.map(r => {
              const st = byRider.get(r.name)!;
              const missing = st.filter(s => s.form.required && s.status !== 'Approved' && s.status !== 'Submitted');
              const isOpen = open === r.name;
              return (
                <li key={r.name}>
                  <button className="row" onClick={() => setOpen(isOpen ? null : r.name)}>
                    <Avatar name={r.name} />
                    <div className="grow">
                      <div className="t">{r.name}</div>
                      <div className="s">{missing.length ? `Still needed: ${missing.map(m => m.form.form).join(', ')}` : 'All required forms in'}</div>
                    </div>
                    {missing.length ? <Tag tone="warn">{missing.length}</Tag> : <Tag tone="ok"><Icon name="check" size={14} stroke={3} /></Tag>}
                  </button>
                  {isOpen && (
                    <div style={{ padding: '0 16px 12px 60px' }}>
                      {st.map(s => (
                        <button key={s.form.id} className="row" style={{ padding: '10px 0', minHeight: 0 }} onClick={() => setReview({ rider: r.name, s })}>
                          <div className="grow"><div className="t" style={{ fontWeight: 500 }}>{s.form.form}</div></div>
                          <Tag tone={toneFor(s)}>{LABEL[s.status]}</Tag>
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </section>
      {review && <ReviewSheet rider={review.rider} s={review.s} files={filesFor(review.s.last)} onClose={() => setReview(null)} />}
    </>
  );
}

function FileRow({ m }: { m: Media }) {
  const url = useMediaUrl(m, 1600);
  const href = m.driveUrl || url;
  return (
    <li className="row">
      <span className="ic"><Icon name={m.mimeType.includes('pdf') ? 'receipt' : 'camera'} /></span>
      <div className="grow"><div className="t">{m.fileName}</div><div className="s">{fmtSize(m.size)}{m._pending ? ' · uploading' : ''}</div></div>
      {href && <a className="btn small quiet" href={href} target="_blank" rel="noreferrer">Open</a>}
    </li>
  );
}

function ReviewSheet({ rider, s, files, onClose }: { rider: string; s: FormToDo; files: Media[]; onClose: () => void }) {
  const [note, setNote] = useState('');
  const [busy, run] = useBusy();
  const l = s.last;
  const act = (status: Submission['status'], n: string, msg: string) => run(async () => {
    await reviewForm(l ? { id: l.id, status, note: n } : { id: newId(), status, note: n, rider, formId: s.form.id, form: s.form.form }, `${s.form.form} for ${rider}`);
    toast(msg);
    onClose();
  });
  return (
    <Sheet title={s.form.form} onClose={onClose}
      foot={l ? (
        <>
          <button className="btn" disabled={busy || !note.trim()} onClick={() => act('Needs redo', note.trim(), `Asked ${rider.split(' ')[0]} for a new copy.`)}>Ask for a new copy</button>
          <button className="btn ok" disabled={busy} onClick={() => act('Approved', note.trim(), 'Approved.')}><Icon name="check" size={18} />Approve</button>
        </>
      ) : (
        <button className="btn ok" disabled={busy} onClick={() => act('Approved', note.trim() || 'Paper copy', 'Marked as received.')}>Mark received on paper</button>
      )}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
        <Avatar name={rider} size={40} />
        <div style={{ flex: 1 }}><div style={{ fontWeight: 700 }}>{rider}</div><div className="small muted">{l ? `Sent ${fmtDate(l.timestamp.slice(0, 10))}` : 'Nothing uploaded yet'}</div></div>
        <Tag tone={toneFor(s)}>{LABEL[s.status]}</Tag>
      </div>
      {l?.note && <div className="banner info" style={{ marginTop: 12 }}><Icon name="message" /><div>{l.note}</div></div>}
      {l && (
        <div className="panel" style={{ marginTop: 12 }}>
          {files.length ? <ul className="list">{files.map(m => <FileRow key={m.id} m={m} />)}</ul>
            : <div className="muted" style={{ padding: 16 }}>No files attached in the app.</div>}
        </div>
      )}
      <Field label={l ? 'Note to the rider' : 'Note (optional)'} hint={l ? 'Needed when asking for a new copy. They get it by email or notification.' : 'For forms handed in on paper or by email.'}>
        <input value={note} onChange={e => setNote(e.target.value)} placeholder={l ? 'e.g. page 2 is missing' : 'Paper copy'} />
      </Field>
      <p className="tiny">Files open in Google Drive. You need access to the Rider Forms folder.</p>
    </Sheet>
  );
}
