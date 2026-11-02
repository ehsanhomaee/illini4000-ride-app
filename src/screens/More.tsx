import { useState } from 'react';
import { apiUrl, isDemo } from '../api/client';
import { resetDemo } from '../api/demo';
import type { Report } from '../api/types';
import { Icon } from '../components/Icon';
import { ReportSheet } from '../components/forms';
import { Avatar, Empty, Field, Tag, TopBar, toast } from '../components/ui';
import { prefs } from '../lib/db';
import { fmtDateTime } from '../lib/dates';
import { callStatus, hasName } from '../lib/jobs';
import { fmtPhone, photoQuality, setPhotoQuality, smsUrl, telUrl, isIOS } from '../lib/media';
import { refreshBoot, signOut, todayDay, useBoot, useOutbox, useRows, useSession } from '../lib/store';
import { discard, enqueueCall, kick, retry, setPaused, syncState } from '../lib/sync';

export function MoreScreen() {
  const { data } = useBoot();
  const { me } = useSession();
  const ops = useOutbox();
  if (!data || !me) return null;
  const myCalls = data.stayovers.filter(s => hasName(s.caller, me.name) && callStatus(data, s).status === 'due').length;
  const items: [string, string, string, string, number?][] = [
    ['#/stayovers', 'bed', 'Stayovers', 'Hosts, food, showers, confirmation calls', myCalls],
    ['#/van', 'van', 'Van', 'Driver rotation, gas log, accidents'],
    ['#/money', 'receipt', 'Receipts', 'Expenses and reimbursements'],
    ['#/money/donations', 'heart', 'Donations', 'Who gave what, thank-you notes'],
    ['#/interviews', 'mic', 'Portrait interviews', 'Record audio, video and photos'],
    ['#/reports', 'alert', 'Reports & comments', 'Route issues, stayover comments, injuries'],
    ['#/team', 'users', 'Team & emergency', 'Phone numbers for everyone'],
    ['#/settings', 'settings', 'Settings & sync', ops.length ? `${ops.length} waiting to upload` : 'Everything is uploaded'],
    ['#/install', 'download', 'Install on your phone', 'Put the app on your home screen'],
  ];
  return (
    <>
      <TopBar title="More" />
      <main className="wrap">
        <div className="panel" style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px' }}>
          <Avatar name={me.name} size={44} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700 }}>{me.name}</div>
            <div className="small muted">{me.role === 'routemaster' ? 'Route master' : me.role === 'leader' ? 'Trip leader' : 'Rider'} · {data.config.teamName}</div>
          </div>
        </div>
        <div className="panel" style={{ marginTop: 14 }}>
          <ul className="list">
            {items.map(([href, icon, t, s, n]) => (
              <li key={href}>
                <a className="row" href={href}>
                  <span className="ic"><Icon name={icon} /></span>
                  <div className="grow"><div className="t">{t}</div><div className="s">{s}</div></div>
                  {n ? <Tag tone="warn">{n}</Tag> : null}
                  <Icon name="chevR" className="chev" />
                </a>
              </li>
            ))}
            {data.config.driveFolderUrl && (
              <li><a className="row" href={data.config.driveFolderUrl} target="_blank" rel="noreferrer"><span className="ic"><Icon name="external" /></span>
                <div className="grow"><div className="t">Open the team Drive folder</div><div className="s">Leaders only</div></div></a></li>
            )}
          </ul>
        </div>
      </main>
    </>
  );
}

// ---------------------------------------------------------------- reports --

export function ReportsScreen() {
  const { data } = useBoot();
  const { me } = useSession();
  const { rows, loading } = useRows('Reports');
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const [adding, setAdding] = useState(false);
  if (!data || !me) return null;
  const current = todayDay(data.itinerary);
  const list = rows.filter(r => filter === 'all' || r.status !== 'Resolved');
  const resolve = async (r: Report) => {
    await enqueueCall('update', { sheet: 'Reports', id: r.id, patch: { status: r.status === 'Resolved' ? 'Open' : 'Resolved' } }, 'Report status');
    toast(r.status === 'Resolved' ? 'Reopened.' : 'Marked resolved.');
  };
  return (
    <>
      <TopBar title="Reports & comments" backTo="/more" right={<button className="iconbtn" aria-label="New report" onClick={() => setAdding(true)}><Icon name="plus" /></button>} />
      <main className="wrap">
        <div className="seg" style={{ marginTop: 16 }}>
          <button className={filter === 'open' ? 'on' : ''} onClick={() => setFilter('open')}>Open</button>
          <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>All</button>
        </div>
        {list.length === 0 && !loading && <Empty icon="check">Nothing open. Report a route issue, an injury or a comment about a stayover any time.</Empty>}
        <div className="panel" style={{ marginTop: 14 }}>
          {list.map(r => (
            <article key={r.id} className="entry">
              <div className="meta">
                <Avatar name={r.author} size={24} />
                <span style={{ flex: 1 }}>{r.author} · Day {r.day} · {fmtDateTime(r.timestamp)}</span>
                <Tag tone={r.category === 'Van accident' || r.severity === 'High' ? 'danger' : r.severity === 'Medium' ? 'warn' : undefined}>{r.category}</Tag>
              </div>
              <div className="text">{r.text}</div>
              {r.details && <div className="text small muted" style={{ marginTop: 6 }}>{r.details}</div>}
              <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {r.lat !== '' && r.lat !== undefined && <a className="btn small quiet" href={`https://maps.google.com/?q=${r.lat},${r.lon}`} target="_blank" rel="noreferrer"><Icon name="pin" size={16} />Location</a>}
                {(me.role !== 'rider' || r.author === me.name) && !r._pending && <button className="btn small quiet" onClick={() => void resolve(r)}>{r.status === 'Resolved' ? 'Reopen' : 'Mark resolved'}</button>}
                {r.status === 'Resolved' && <Tag tone="ok">Resolved{r.resolvedBy ? ` by ${r.resolvedBy}` : ''}</Tag>}
                {r._pending && <Tag>Waiting to sync</Tag>}
              </div>
            </article>
          ))}
        </div>
      </main>
      {adding && <ReportSheet day={current?.day ?? 1} onClose={() => setAdding(false)} />}
    </>
  );
}

// ------------------------------------------------------------------- team --

export function TeamScreen() {
  const { data } = useBoot();
  if (!data) return null;
  const role = (r: string) => (r === 'routemaster' ? 'Route master' : r === 'leader' ? 'Leader' : '');
  const sorted = [...data.riders].sort((a, b) => (a.role === 'rider' ? 1 : 0) - (b.role === 'rider' ? 1 : 0) || a.name.localeCompare(b.name));
  return (
    <>
      <TopBar title="Team & emergency" backTo="/more" />
      <main className="wrap">
        <div className="banner danger" style={{ marginTop: 16 }}>
          <Icon name="sos" />
          <div style={{ flex: 1 }}>
            <div className="pre">{data.config.emergencyInfo || 'In an emergency call 911 first, then the trip leaders.'}</div>
            <a className="btn small danger" style={{ marginTop: 10 }} href="tel:911">Call 911</a>
          </div>
        </div>
        <div className="panel" style={{ marginTop: 14 }}>
          <ul className="list">
            {sorted.map(r => (
              <li key={r.name} className="row">
                <Avatar name={r.name} />
                <div className="grow">
                  <div className="t">{r.name} {role(r.role) && <Tag tone="orange">{role(r.role)}</Tag>}</div>
                  <div className="s">{r.phone ? fmtPhone(r.phone) : 'No phone listed'}{r.canDrive ? ' · van driver' : ''}</div>
                  {r.emergencyContact && <div className="s">Emergency: {r.emergencyContact}</div>}
                </div>
                {r.phone && <>
                  <a className="iconbtn" href={smsUrl(r.phone)} aria-label={`Text ${r.name}`}><Icon name="message" /></a>
                  <a className="iconbtn" href={telUrl(r.phone)} aria-label={`Call ${r.name}`}><Icon name="phone" /></a>
                </>}
              </li>
            ))}
          </ul>
        </div>
      </main>
    </>
  );
}

// --------------------------------------------------------------- settings --

export function SettingsScreen() {
  const { data } = useBoot();
  const { me } = useSession();
  const ops = useOutbox();
  const st = syncState();
  const [quality, setQ] = useState(photoQuality());
  const [theme, setTheme] = useState(prefs.get<'auto' | 'light' | 'dark'>('theme', 'auto'));
  const [override, setOverride] = useState(prefs.get('apiUrlOverride', ''));
  const applyTheme = (t: 'auto' | 'light' | 'dark') => {
    setTheme(t); prefs.set('theme', t);
    if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
  };
  if (!me) return null;
  return (
    <>
      <TopBar title="Settings & sync" backTo="/more" />
      <main className="wrap">
        <section className="sec">
          <h2>Uploads <span className="aside">{st.running ? 'Sending…' : ops.length ? `${ops.length} waiting` : 'All sent'}</span></h2>
          <div className="panel">
            {ops.length === 0 ? <div className="muted" style={{ padding: 16 }}>Everything you added is on the server.</div> : (
              <ul className="list">
                {ops.map(o => (
                  <li key={o.id} className="row">
                    <span className="ic"><Icon name={o.type === 'upload' ? 'cloud' : 'refresh'} /></span>
                    <div className="grow">
                      <div className="t">{o.label}</div>
                      <div className="s">{o.error ? `Problem: ${o.error}` : o.type === 'upload' ? `${Math.round((o.offset / Math.max(1, o.meta.size)) * 100)}% of ${(o.meta.size / 1048576).toFixed(1)} MB` : 'Waiting for signal'}</div>
                    </div>
                    {o.error && <button className="btn small" onClick={() => void retry(o.id)}>Retry</button>}
                    <button className="iconbtn" aria-label="Remove" onClick={() => { if (confirm('Remove this from the upload queue? It will not be saved.')) void discard(o.id); }}><Icon name="trash" size={18} /></button>
                  </li>
                ))}
              </ul>
            )}
            <div style={{ display: 'flex', gap: 8, padding: '0 16px 14px', flexWrap: 'wrap' }}>
              <button className="btn small" onClick={() => { kick(); void refreshBoot(); toast('Syncing…'); }}><Icon name="refresh" size={16} />Sync now</button>
              <button className="btn small quiet" onClick={() => { setPaused(!st.paused); toast(st.paused ? 'Uploads resumed.' : 'Uploads paused. Resume on Wi-Fi.'); }}>{st.paused ? 'Resume uploads' : 'Pause uploads'}</button>
            </div>
            {st.lastError && <div className="tiny" style={{ padding: '0 16px 12px' }}>Last problem: {st.lastError}</div>}
          </div>
        </section>

        <section className="sec">
          <h2>Photo size</h2>
          <div className="seg">
            <button className={quality === 'standard' ? 'on' : ''} onClick={() => { setQ('standard'); setPhotoQuality('standard'); }}>Standard (faster)</button>
            <button className={quality === 'original' ? 'on' : ''} onClick={() => { setQ('original'); setPhotoQuality('original'); }}>Original</button>
          </div>
          <p className="tiny">Standard shrinks photos to about 1 MB, which saves Drive space and uploads on weak signal. Original keeps full size and the photo's location and time info.</p>
        </section>

        <section className="sec">
          <h2>Appearance</h2>
          <div className="seg">
            {(['auto', 'light', 'dark'] as const).map(t => <button key={t} className={theme === t ? 'on' : ''} onClick={() => applyTheme(t)}>{t === 'auto' ? 'Match phone' : t === 'light' ? 'Light' : 'Dark'}</button>)}
          </div>
        </section>

        <section className="sec">
          <h2>Account</h2>
          <div className="panel pad">
            <div>Signed in as <b>{me.name}</b></div>
            <div className="small muted">{isDemo() ? 'Demo mode: data stays on this phone.' : `Connected to ${data?.config.teamName || 'the team'} sheet.`}</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <button className="btn small" onClick={() => { if (!ops.length || confirm(`${ops.length} items have not uploaded yet. Sign out anyway? They stay on this phone.`)) void signOut(); }}>Sign out</button>
              {isDemo() && <button className="btn small quiet" onClick={async () => { await resetDemo(); await signOut(); toast('Demo data reset.'); }}>Reset demo data</button>}
            </div>
          </div>
        </section>

        {me.role !== 'rider' && (
          <section className="sec">
            <h2>Backend (leaders)</h2>
            <div className="panel pad">
              <div className="small muted" style={{ overflowWrap: 'anywhere' }}>{apiUrl() || 'No backend: demo mode'}</div>
              <Field label="Use a different backend on this phone" hint="For testing a copy of the sheet. Leave empty to use the one in config.json.">
                <input value={override} onChange={e => setOverride(e.target.value)} placeholder="https://script.google.com/macros/s/…/exec" />
              </Field>
              <button className="btn small" style={{ marginTop: 10 }} onClick={async () => { prefs.set('apiUrlOverride', override.trim()); await signOut(); location.reload(); }}>Save and sign in again</button>
            </div>
          </section>
        )}
        <p className="tiny" style={{ margin: '24px 0' }}>Illini 4000 Ride App · {isIOS() ? 'iPhone' : 'Android/desktop'} · v1.0</p>
      </main>
    </>
  );
}
