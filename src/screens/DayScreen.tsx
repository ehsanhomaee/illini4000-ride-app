import { useEffect, useMemo, useRef, useState } from 'react';
import type { Bootstrap, CheckinType, Day, ReportCategory, Stayover } from '../api/types';
import { Icon } from '../components/Icon';
import {
  DonationSheet, DutySheet, ExpenseSheet, GasSheet, InterviewSheet, JournalSheet, PhotoUploadSheet, ReportSheet, RouteSheet,
  StayoverCallSheet, SwapDriverSheet, getPosition,
} from '../components/forms';
import { Avatar, Empty, Tag, go, toast } from '../components/ui';
import { addDays, daysBetween, fmtDate, fmtTime, isoLocal, newId, relativeDay } from '../lib/dates';
import { callStatus, hasName, jobsFor, namesIn, type Job } from '../lib/jobs';
import { directionsUrl, fmtPhone, rwgpsEmbed, telUrl } from '../lib/media';
import { addRow, mutate, refreshBoot, useBoot, useRows, useSession, useMediaUrl } from '../lib/store';
import { bearing, compass, coordsFor, forecastFor, sky, windFeel, type Forecast } from '../lib/weather';
import type { Media } from '../api/types';
import { uploadProgress } from '../lib/sync';

type SheetState =
  | { t: 'photo'; files: File[] } | { t: 'journal' } | { t: 'report'; cat?: ReportCategory } | { t: 'gas' } | { t: 'expense' }
  | { t: 'donation' } | { t: 'interview' } | { t: 'swap' } | { t: 'call'; s: Stayover; label: string } | { t: 'route' } | { t: 'duty' } | null;

export function DayScreen({ dayNum }: { dayNum?: number }) {
  const { data } = useBoot();
  const { me } = useSession();
  const today = isoLocal();
  const day = useMemo(() => {
    if (!data?.itinerary.length) return undefined;
    if (dayNum) return data.itinerary.find(d => d.day === dayNum);
    return data.itinerary.find(d => d.date === today) || (today < data.itinerary[0].date ? data.itinerary[0] : data.itinerary[data.itinerary.length - 1]);
  }, [data, dayNum, today]);
  const [sheet, setSheet] = useState<SheetState>(null);
  const photoInput = useRef<HTMLInputElement>(null);

  useEffect(() => { window.scrollTo(0, 0); }, [day?.day]);

  if (!data || !me) return <div className="wrap"><Empty icon="refresh">Loading the itinerary…</Empty></div>;
  if (!day) {
    return (
      <>
        <header className="sign"><div className="wrap"><div className="sign-route">{data.config.teamName}</div></div></header>
        <div className="wrap"><Empty icon="route">The itinerary is empty. The route master fills the Itinerary tab in the team sheet, then pull down to refresh.</Empty></div>
      </>
    );
  }

  const prev = data.itinerary.find(d => d.day === day.day - 1);
  const next = data.itinerary.find(d => d.day === day.day + 1);
  const jobs = jobsFor(data, me.name, day, today);
  const stay = data.stayovers.find(s => s.id === day.stayoverId);
  const isLeader = me.role !== 'rider';
  const canRoute = isLeader || hasName(day.routeLeader, me.name);
  const miles = day.routeMiles !== '' ? day.routeMiles : day.plannedMiles;
  const embed = day.rwgpsLink ? rwgpsEmbed(day.rwgpsLink) : null;
  const before = today < data.itinerary[0].date;

  const close = () => setSheet(null);

  return (
    <>
      <header className="sign">
        <div className="wrap">
          <div className="sign-top">
            <div className="sign-day">
              <b>Day {day.day}</b>
              <span>{fmtDate(day.date, { weekday: 'long', month: 'short', day: 'numeric' })}</span>
            </div>
            <div className="sign-nav">
              <button className="iconbtn" aria-label="Previous day" disabled={!prev} onClick={() => prev && go('/day/' + prev.day)}><Icon name="chevL" /></button>
              <button className="iconbtn" aria-label="Next day" disabled={!next} onClick={() => next && go('/day/' + next.day)}><Icon name="chevR" /></button>
            </div>
          </div>
          {day.date !== today && (
            <div className="tiny" style={{ color: '#c9d5e6', marginTop: 2 }}>
              {before && day.day === data.itinerary[0].day ? `The ride starts ${relativeDay(day.date, today)}.` : `This is ${relativeDay(day.date, today)}.`}
              {dayNum && <> <a href="#/" style={{ color: '#fff', textDecoration: 'underline' }}>Back to today</a></>}
            </div>
          )}
          <h1 className="sign-route">
            {day.restDay ? <>Rest day<span className="to">{day.to}</span></> : <>{short(day.from)}<span className="arrow">→</span><span className="to">{short(day.to)}</span></>}
          </h1>
          {!day.restDay && (
            <div className="plates">
              <div className="plate mile">
                <span className="v">{miles !== '' ? `${day.routeMiles === '' ? '≈' : ''}${Math.round(Number(miles))} mi` : '? mi'}</span>
                <span className="k">{day.routeMiles !== '' ? 'RideWithGPS' : 'planned'}</span>
              </div>
              {day.elevationGainFt !== '' && <div className="plate"><span className="v">{Number(day.elevationGainFt).toLocaleString()} ft</span><span className="k">climbing</span></div>}
              {day.driver && <div className="plate"><span className="v">{namesIn(day.driver).map(n => n.split(' ')[0]).join(' & ')}</span><span className="k">van driver</span></div>}
            </div>
          )}
          <div className="sign-actions">
            {day.rwgpsLink && <a className="btn small primary" href={day.rwgpsLink} target="_blank" rel="noreferrer"><Icon name="route" size={18} />Open in RideWithGPS</a>}
            {!day.rwgpsLink && canRoute && !day.restDay && <button className="btn small primary" onClick={() => setSheet({ t: 'route' })}><Icon name="plus" size={18} />Add RideWithGPS route</button>}
            {day.rwgpsLink && canRoute && <button className="btn small" onClick={() => setSheet({ t: 'route' })}>Edit route</button>}
          </div>
        </div>
      </header>

      <main className="wrap">
        <Jobs jobs={jobs} me={me.name} openCall={(s, label) => setSheet({ t: 'call', s, label })} openSwap={() => setSheet({ t: 'swap' })}
          openGas={() => setSheet({ t: 'gas' })} openRoute={d => d.day === day.day ? setSheet({ t: 'route' }) : go('/day/' + d.day)} />
        {isLeader && <div style={{ marginTop: 8 }}><button className="btn small quiet" onClick={() => setSheet({ t: 'duty' })}><Icon name="plus" size={16} />Add a job for Day {day.day}</button></div>}

        <section className="sec">
          <h2>Log something</h2>
          <div className="quick">
            <button onClick={() => photoInput.current?.click()}><Icon name="camera" />Photos</button>
            <button onClick={() => setSheet({ t: 'journal' })}><Icon name="journal" />Journal</button>
            <button onClick={() => setSheet({ t: 'report' })}><Icon name="alert" />Report</button>
            <button onClick={() => setSheet({ t: 'report', cat: 'Route comment' })}><Icon name="message" />Route note</button>
            <button onClick={() => setSheet({ t: 'gas' })}><Icon name="gas" />Gas</button>
            <button onClick={() => setSheet({ t: 'expense' })}><Icon name="receipt" />Receipt</button>
            <button onClick={() => setSheet({ t: 'donation' })}><Icon name="heart" />Donation</button>
            <button onClick={() => setSheet({ t: 'interview' })}><Icon name="mic" />Interview</button>
          </div>
          <input ref={photoInput} className="hidden-input" type="file" accept="image/*,video/*" multiple
            onChange={e => { const f = Array.from(e.target.files || []); e.target.value = ''; if (f.length) setSheet({ t: 'photo', files: f }); }} />
        </section>

        <Weather day={day} />

        {!day.restDay && <TeamBoard day={day} riders={data.riders.map(r => r.name)} me={me.name} isLeader={isLeader} />}

        <section className="sec">
          <h2>Tonight: {stay ? stay.name : 'no stayover set'}</h2>
          {stay ? <StayoverCard stay={stay} data={data} openCall={label => setSheet({ t: 'call', s: stay, label })} /> :
            <div className="panel pad muted">Add a Stayover ID for Day {day.day} in the Itinerary tab of the sheet.</div>}
        </section>

        {(day.routeNotes || day.notesFromPreviousRiders) && (
          <section className="sec">
            <h2>Route notes</h2>
            <div className="panel">
              {day.routeNotes && <div className="entry"><div className="meta"><Icon name="route" size={16} />From the route master</div><div className="text">{day.routeNotes}</div></div>}
              {day.notesFromPreviousRiders && <div className="entry"><div className="meta"><Icon name="flag" size={16} />From last year's riders</div><div className="text">{day.notesFromPreviousRiders}</div></div>}
            </div>
          </section>
        )}
        <RouteComments day={day.day} onAdd={() => setSheet({ t: 'report', cat: 'Route comment' })} />

        {embed && <RouteMap src={embed} />}

        <DayPhotos day={day.day} onAdd={() => photoInput.current?.click()} />

        <section className="sec">
          <h2>Van</h2>
          <div className="panel">
            <ul className="list">
              <li className="row">
                <span className="ic"><Icon name="van" /></span>
                <div className="grow"><div className="t">{day.driver || 'No driver yet'}</div><div className="s">Van driver for Day {day.day}</div></div>
                <button className="btn small" onClick={() => setSheet({ t: 'swap' })}><Icon name="swap" size={16} />Change</button>
              </li>
              {namesIn(day.driver).map(n => data.riders.find(r => r.name === n)).filter(r => r?.phone).map(r => (
                <li key={r!.name}><a className="row" href={telUrl(r!.phone)}><span className="ic"><Icon name="phone" /></span><div className="grow"><div className="t">Call {r!.name.split(' ')[0]}</div><div className="s">{fmtPhone(r!.phone)}</div></div></a></li>
              ))}
              <li><button className="row" onClick={() => setSheet({ t: 'gas' })}><span className="ic"><Icon name="gas" /></span><div className="grow"><div className="t">Log gas</div><div className="s">Gallons, price and the receipt</div></div><Icon name="chevR" className="chev" /></button></li>
              <li><button className="row" onClick={() => setSheet({ t: 'report', cat: 'Van accident' })}><span className="ic" style={{ color: 'var(--danger)' }}><Icon name="sos" /></span><div className="grow"><div className="t">Report an accident</div><div className="s">Leaders are alerted</div></div><Icon name="chevR" className="chev" /></button></li>
            </ul>
          </div>
        </section>

        <div style={{ margin: '28px 0 8px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn small quiet" onClick={() => { void refreshBoot(); toast('Refreshing…'); }}><Icon name="refresh" size={16} />Refresh</button>
          <a className="btn small quiet" href="#/route">All days</a>
        </div>
      </main>

      {sheet?.t === 'photo' && <PhotoUploadSheet day={day.day} initial={sheet.files} onClose={close} />}
      {sheet?.t === 'journal' && <JournalSheet day={day.day} onClose={close} />}
      {sheet?.t === 'report' && <ReportSheet day={day.day} category={sheet.cat} onClose={close} />}
      {sheet?.t === 'gas' && <GasSheet day={day.day} onClose={close} />}
      {sheet?.t === 'expense' && <ExpenseSheet day={day.day} onClose={close} />}
      {sheet?.t === 'donation' && <DonationSheet day={day.day} onClose={close} />}
      {sheet?.t === 'interview' && <InterviewSheet day={day.day} onClose={close} onCreated={id => { close(); go('/interview/' + id); }} />}
      {sheet?.t === 'swap' && <SwapDriverSheet day={day} onClose={close} />}
      {sheet?.t === 'call' && <StayoverCallSheet stayover={sheet.s} dayLabel={sheet.label} onClose={close} />}
      {sheet?.t === 'route' && <RouteSheet day={day} onClose={close} />}
      {sheet?.t === 'duty' && <DutySheet day={day.day} onClose={close} />}
    </>
  );
}

function short(place: string) { return place.split(',')[0]; }

// -------------------------------------------------------------- your jobs --

function Jobs({ jobs, me, openCall, openSwap, openGas, openRoute }: {
  jobs: Job[]; me: string; openCall: (s: Stayover, label: string) => void; openSwap: () => void; openGas: () => void; openRoute: (d: Day) => void;
}) {
  return (
    <section className="sec">
      <h2>Your jobs today <span className="aside">{me.split(' ')[0]}</span></h2>
      {jobs.length === 0 ? (
        <div className="panel pad muted">Nothing assigned to you. Enjoy the ride.</div>
      ) : (
        <div className="panel">
          {jobs.map((j, i) => {
            if (j.kind === 'duty') {
              const d = j.duty;
              return (
                <div key={i} className={'job' + (d.done ? ' done' : '')}>
                  <button className={'mark' + (d.done ? ' done' : '')} aria-label={d.done ? 'Mark not done' : 'Mark done'}
                    onClick={() => void mutate('toggleDuty', { id: d.id, done: !d.done }, d.duty)}>{d.done && <Icon name="check" size={18} stroke={3} />}</button>
                  <div className="body">
                    <div className="t">{d.duty}</div>
                    {(() => {
                      const others = namesIn(d.person).filter(n => n.toLowerCase() !== me.toLowerCase());
                      const who = others.some(n => /^(everyone|all)$/i.test(n)) ? 'Whole team' : others.length ? `With ${others.join(', ')}` : '';
                      const line = [d.details, who].filter(Boolean).join(' · ');
                      return line ? <div className="s">{line}</div> : null;
                    })()}
                    {d.done && d.doneBy && <div className="s">Done by {d.doneBy} at {fmtTime(d.doneAt)}</div>}
                  </div>
                </div>
              );
            }
            if (j.kind === 'driver') return (
              <div key={i} className="job">
                <span className="mark static"><Icon name="van" size={16} /></span>
                <div className="body"><div className="t">You're driving the van</div><div className="s">Log gas and receipts as you go.</div>
                  <div className="acts"><button className="btn small" onClick={openGas}><Icon name="gas" size={16} />Log gas</button><button className="btn small quiet" onClick={openSwap}>Trade with someone</button></div></div>
              </div>
            );
            if (j.kind === 'driver-tomorrow') return (
              <div key={i} className="job">
                <span className="mark static"><Icon name="van" size={16} /></span>
                <div className="body"><div className="t">You drive tomorrow</div><div className="s">Day {j.day.day}: {short(j.day.from)} → {short(j.day.to)}</div></div>
              </div>
            );
            if (j.kind === 'route') return (
              <div key={i} className="job">
                <span className="mark static"><Icon name="route" size={16} /></span>
                <div className="body"><div className="t">Add the RideWithGPS route for Day {j.day.day}</div><div className="s">{short(j.day.from)} → {short(j.day.to)}. Miles and climbing fill in automatically.</div>
                  <div className="acts"><button className="btn small primary" onClick={() => openRoute(j.day)}>Add route</button></div></div>
              </div>
            );
            if (j.kind === 'forms') {
              const redo = j.todo.filter(f => f.status === 'Needs redo');
              const missing = j.todo.filter(f => f.status === 'Missing');
              return (
                <div key={i} className="job">
                  <span className="mark static"><Icon name="receipt" size={16} /></span>
                  <div className="body">
                    <div className="t">{redo.length && !missing.length ? 'A form needs a new copy' : 'Hand in your forms'}</div>
                    <div className="s">{[...redo.map(f => `${f.form.form} (new copy)`), ...missing.map(f => f.form.form)].join(', ')}</div>
                    <div className="acts"><a className="btn small primary" href="#/forms">Upload forms</a></div>
                  </div>
                </div>
              );
            }
            const label =`Day ${j.day.day} · ${fmtDate(j.day.date)} (${relativeDay(j.day.date)})`;
            return (
              <div key={i} className="job">
                <button className="mark" aria-label="Confirm stayover" onClick={() => openCall(j.stayover, label)} />
                <div className="body">
                  <div className="t">Call to confirm {j.stayover.name}</div>
                  <div className="s">{label}{j.stayover.contactName ? ` · ${j.stayover.contactName}` : ''}</div>
                  <div className="acts">
                    {j.stayover.contactPhone && <a className="btn small" href={telUrl(j.stayover.contactPhone)}><Icon name="phone" size={16} />Call</a>}
                    <button className="btn small ok" onClick={() => openCall(j.stayover, label)}><Icon name="check" size={16} />Mark confirmed</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- weather --

function Weather({ day }: { day: Day }) {
  const [start, setStart] = useState<Forecast | null>(null);
  const [end, setEnd] = useState<Forecast | null>(null);
  const [travel, setTravel] = useState<number | null>(null);
  const [state, setState] = useState<'loading' | 'done'>('loading');
  useEffect(() => {
    let live = true;
    setStart(null); setEnd(null); setState('loading');
    (async () => {
      const [a, b] = await Promise.all([forecastFor(day, 'start'), day.restDay ? Promise.resolve(null) : forecastFor(day, 'end')]);
      const [ca, cb] = await Promise.all([coordsFor(day, 'start').catch(() => null), coordsFor(day, 'end').catch(() => null)]);
      if (!live) return;
      setStart(a); setEnd(b); setState('done');
      setTravel(ca && cb && (ca.lat !== cb.lat || ca.lon !== cb.lon) ? bearing(ca, cb) : null);
    })();
    return () => { live = false; };
  }, [day.day, day.date]); // eslint-disable-line react-hooks/exhaustive-deps

  const main = end || start;
  return (
    <section className="sec">
      <h2>Weather {main && <span className="aside">{sky(main.code)}</span>}</h2>
      {!main ? (
        <div className="panel pad muted">{state === 'loading' ? 'Getting the forecast…'
          : daysBetween(isoLocal(), day.date) > 15 ? `Forecasts show up about two weeks ahead, around ${fmtDate(addDays(day.date, -15))}.`
          : !navigator.onLine ? 'No signal. The forecast loads when you are back online.'
          : 'Could not reach the weather service. Try Refresh in a bit.'}</div>
      ) : (
        <div className="wx">
          {[start, day.restDay ? null : end].filter(Boolean).map((f, i) => (
            <div key={i} style={day.restDay ? { gridColumn: '1 / -1' } : undefined}>
              <div className="place">{i === 0 && !day.restDay ? 'Start' : day.restDay ? 'Today' : 'Finish'} · {short(f!.place)}</div>
              <div className="temp">{Math.round(f!.highF)}°<small> / {Math.round(f!.lowF)}°</small></div>
              <div className="line"><Icon name="rain" size={16} /> {f!.rainChance}% rain{f!.rainIn > 0.02 ? ` · ${f!.rainIn.toFixed(2)} in` : ''}</div>
            </div>
          ))}
          <div className="wide">
            <Icon name="wind" />
            <span>{Math.round(main.windMph)} mph from the {compass(main.windFromDeg)}, gusts {Math.round(main.gustMph)}</span>
            {travel !== null && !day.restDay && (() => {
              const feel = windFeel(main.windFromDeg, travel);
              return <Tag tone={feel === 'Headwind' ? 'warn' : feel === 'Tailwind' ? 'ok' : undefined}>{feel}</Tag>;
            })()}
          </div>
          <div className="wide tiny" style={{ color: 'var(--ink-3)' }}>
            Sunrise {fmtTime(main.sunrise)} · sunset {fmtTime(main.sunset)} · Open-Meteo, updated {fmtTime(new Date(main.fetchedAt).toISOString())}
          </div>
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------- team board --

const CHECK_TYPES: { type: CheckinType; label: string; icon: string }[] = [
  { type: 'Left stayover', label: 'I left', icon: 'depart' },
  { type: 'Arrived', label: 'I arrived', icon: 'arrive' },
  { type: 'In the van', label: 'In the van', icon: 'van' },
];

function TeamBoard({ day, riders, me, isLeader }: { day: Day; riders: string[]; me: string; isLeader: boolean }) {
  const { rows } = useRows('Checkins', day.day);
  const [open, setOpen] = useState(false);
  const latest = new Map<string, { type: string; timestamp: string }>();
  for (const r of [...rows].reverse()) if (r.type !== 'Team checked in at stayover' && r.type !== 'Team checked out of stayover') latest.set(r.rider, r);
  const arrived = riders.filter(n => latest.get(n)?.type === 'Arrived');
  const mine = latest.get(me);
  const team = rows.filter(r => r.type.startsWith('Team'));
  const check = async (type: CheckinType) => {
    const pos = await getPosition();
    await addRow('Checkins', { id: newId(), timestamp: new Date().toISOString(), day: day.day, rider: me, type, lat: pos?.lat ?? '', lon: pos?.lon ?? '', note: '' }, type);
    toast(type === 'Arrived' ? 'Checked in. Nice riding!' : `Saved: ${type.toLowerCase()}.`);
  };
  return (
    <section className="sec">
      <h2>Team check-in <span className="aside">{arrived.length} of {riders.length} arrived</span></h2>
      <div className="panel">
        <div style={{ display: 'flex', gap: 8, padding: '12px 16px', flexWrap: 'wrap' }}>
          {CHECK_TYPES.map(c => (
            <button key={c.type} className={'btn small' + (mine?.type === c.type ? ' navy' : '')} onClick={() => void check(c.type)}><Icon name={c.icon} size={16} />{c.label}</button>
          ))}
        </div>
        {mine && <div className="tiny" style={{ padding: '0 16px 10px' }}>You: {mine.type.toLowerCase()} at {fmtTime(mine.timestamp)}</div>}
        {isLeader && (
          <div style={{ display: 'flex', gap: 8, padding: '0 16px 12px', flexWrap: 'wrap' }}>
            <button className="btn small quiet" onClick={() => void check('Team checked in at stayover')}>Team checked in at stayover</button>
            <button className="btn small quiet" onClick={() => void check('Team checked out of stayover')}>Team checked out</button>
          </div>
        )}
        {team.length > 0 && <div className="tiny" style={{ padding: '0 16px 10px' }}>{team.map(t => `${t.type} at ${fmtTime(t.timestamp)}`).join(' · ')}</div>}
        <button className="row" onClick={() => setOpen(!open)}>
          <div className="grow"><div className="t">{open ? 'Hide' : 'See'} where everyone is</div></div>
          <Icon name={open ? 'chevL' : 'chevR'} className="chev" />
        </button>
        {open && (
          <ul className="list">
            {riders.map(n => {
              const l = latest.get(n);
              return (
                <li key={n} className="row">
                  <Avatar name={n} />
                  <div className="grow"><div className="t">{n}</div><div className="s">{l ? `${l.type} · ${fmtTime(l.timestamp)}` : 'No check-in yet'}</div></div>
                  {l?.type === 'Arrived' && <Tag tone="ok">Arrived</Tag>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

// --------------------------------------------------------------- stayover --

export function StayoverCard({ stay, data, openCall, full }: { stay: Stayover; data: Bootstrap; openCall: (label: string) => void; full?: boolean }) {
  const st = callStatus(data, stay);
  const label = st.day ? `Day ${st.day.day} · ${fmtDate(st.day.date)} (${relativeDay(st.day.date)})` : '';
  const facts: [string, string, string][] = ([
    ['clock', 'Check-in', stay.checkInTime], ['clock', 'Check-out', stay.checkOutTime],
    ['food', 'Dinner', stay.dinner], ['food', 'Breakfast', stay.breakfast], ['food', 'Lunch', stay.lunch],
    ['shower', 'Showers', stay.showers], ['laundry', 'Laundry', stay.laundry], ['bed', 'Sleeping', stay.sleeping],
    ['wifi', 'WiFi', stay.wifi], ['park', 'Van parking', stay.vanParking],
  ] as [string, string, string][]).filter(f => f[2]);
  return (
    <div className="panel">
      <div style={{ padding: '14px 16px 12px' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {stay.confirmed ? <Tag tone="ok"><Icon name="check" size={14} stroke={3} />Confirmed</Tag>
            : st.status === 'due' ? <Tag tone="warn">Needs a call</Tag> : <Tag>Not confirmed yet</Tag>}
          <span className="small muted">
            {stay.confirmed ? `by ${stay.confirmedBy}${stay.confirmedAt ? ', ' + fmtDate(stay.confirmedAt.slice(0, 10)) : ''}` : stay.caller ? `${stay.caller} is calling` : 'Nobody assigned to call'}
          </span>
        </div>
        {(stay.address || stay.city) && <div style={{ marginTop: 8 }}>{[stay.address, stay.city].filter(Boolean).join(', ')}</div>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          <a className="btn small" href={directionsUrl([stay.name, stay.address, stay.city].filter(Boolean).join(', '), stay.address ? '' : stay.lat, stay.address ? '' : stay.lon)} target="_blank" rel="noreferrer"><Icon name="pin" size={16} />Directions</a>
          {stay.contactPhone && <a className="btn small" href={telUrl(stay.contactPhone)}><Icon name="phone" size={16} />{stay.contactName ? `Call ${stay.contactName.split(' ')[0]}` : 'Call host'}</a>}
          {!stay.confirmed && <button className="btn small ok" onClick={() => openCall(label)}><Icon name="check" size={16} />Confirm</button>}
          {!full && <a className="btn small quiet" href={'#/stayover/' + encodeURIComponent(stay.id)}>Details</a>}
        </div>
      </div>
      {facts.length > 0 && (
        <div className="facts">
          {facts.map(([ic, k, v]) => (
            <div key={k} className={'fact' + (v.length > 28 ? ' full' : '')}><div className="k"><Icon name={ic} size={14} />{k}</div><div className="v">{v}</div></div>
          ))}
        </div>
      )}
      {stay.notes && <div className="entry"><div className="meta">Notes</div><div className="text">{stay.notes}</div></div>}
      {stay.callNotes && <div className="entry"><div className="meta">From the confirmation call</div><div className="text">{stay.callNotes}</div></div>}
    </div>
  );
}

// ---------------------------------------------------------- route comments --

function RouteComments({ day, onAdd }: { day: number; onAdd: () => void }) {
  const { rows } = useRows('Reports', day);
  const list = rows.filter(r => r.category === 'Route comment' || r.category === 'Route issue');
  if (!list.length) return null;
  return (
    <section className="sec">
      <h2>From riders today <span className="aside"><button className="btn small quiet" onClick={onAdd}>Add</button></span></h2>
      <div className="panel">
        {list.map(r => (
          <div key={r.id} className="entry">
            <div className="meta"><Avatar name={r.author} size={24} />{r.author} · {fmtTime(r.timestamp)} {r.category === 'Route issue' && <Tag tone="warn">Issue</Tag>}{r._pending && <Tag>Waiting to sync</Tag>}</div>
            <div className="text">{r.text}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function RouteMap({ src }: { src: string }) {
  const [show, setShow] = useState(false);
  return (
    <section className="sec">
      <h2>Map</h2>
      {show ? <iframe className="embed" src={src} title="Route map" loading="lazy" /> :
        <button className="btn block" onClick={() => setShow(true)}><Icon name="route" size={18} />Show the route map (uses data)</button>}
    </section>
  );
}

function DayPhotos({ day, onAdd }: { day: number; onAdd: () => void }) {
  const { rows } = useRows('Media', day);
  const pics = rows.filter(m => m.kind === 'photo' || m.kind === 'video');
  return (
    <section className="sec">
      <h2>Photos <span className="aside">{pics.length ? <a href={'#/photos?day=' + day}>See all {pics.length}</a> : ''}</span></h2>
      {pics.length === 0 ? (
        <div className="panel pad"><span className="muted">No photos for this day yet.</span> <button className="btn small primary" style={{ marginLeft: 8 }} onClick={onAdd}>Add photos</button></div>
      ) : (
        <div className="grid">{pics.slice(0, 6).map(m => <Thumb key={m.id} m={m} onClick={() => go('/photos?day=' + day)} />)}</div>
      )}
    </section>
  );
}

export function Thumb({ m, onClick }: { m: Media; onClick: () => void }) {
  const url = useMediaUrl(m, 400);
  const [failed, setFailed] = useState(false);
  const isVideo = m.mimeType.startsWith('video/');
  return (
    <button className="tile" onClick={onClick} aria-label={m.caption || m.fileName}>
      {url && !failed ? (isVideo && m.localUrl ? <video src={url} muted playsInline preload="metadata" /> : <img src={url} alt="" loading="lazy" onError={() => setFailed(true)} />)
        : <div className="ph">{isVideo ? 'Video' : m.fileName}</div>}
      {isVideo && <span className="badge"><Icon name="video" size={12} />Video</span>}
      {m._pending && <span className="bar"><i style={{ width: `${Math.max(5, (uploadProgress(m.id) || 0) * 100)}%` }} /></span>}
    </button>
  );
}
