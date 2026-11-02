import { useState } from 'react';
import { Icon } from '../components/Icon';
import { StayoverCallSheet, StayoverEditSheet } from '../components/forms';
import { Avatar, Empty, Tag, TopBar, toast } from '../components/ui';
import { fmtDate, fmtTime, relativeDay } from '../lib/dates';
import { callStatus, hasName, nightsAt } from '../lib/jobs';
import { mutate, useBoot, useRows, useSession } from '../lib/store';
import { StayoverCard } from './DayScreen';

export function StayoversScreen() {
  const { data } = useBoot();
  const { me } = useSession();
  const [filter, setFilter] = useState<'upcoming' | 'mine' | 'all'>('upcoming');
  if (!data || !me) return null;
  const ahead = data.config.confirmDaysAhead || 5;
  const items = data.stayovers
    .map(s => ({ s, st: callStatus(data, s) }))
    .sort((a, b) => (a.st.day?.day ?? 999) - (b.st.day?.day ?? 999))
    .filter(({ s, st }) => filter === 'all' || (filter === 'mine' ? hasName(s.caller, me.name) : st.daysAway === null || st.daysAway >= 0));
  const due = data.stayovers.filter(s => callStatus(data, s).status === 'due');

  return (
    <>
      <TopBar title="Stayovers" backTo="/more" />
      <main className="wrap">
        <div className={'banner' + (due.length ? '' : ' ok')} style={{ marginTop: 16 }}>
          <Icon name={due.length ? 'phone' : 'check'} />
          <div>{due.length
            ? `${due.length} ${due.length === 1 ? 'stayover needs' : 'stayovers need'} a confirmation call (arriving in the next ${ahead} days).`
            : `Every stayover in the next ${ahead} days is confirmed.`}</div>
        </div>
        <div className="seg" style={{ marginTop: 14 }}>
          <button className={filter === 'upcoming' ? 'on' : ''} onClick={() => setFilter('upcoming')}>Upcoming</button>
          <button className={filter === 'mine' ? 'on' : ''} onClick={() => setFilter('mine')}>I'm calling</button>
          <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>All</button>
        </div>
        {items.length === 0 && <Empty icon="bed">{filter === 'mine' ? 'You are not assigned to call any stayovers.' : 'No stayovers in the sheet yet.'}</Empty>}
        <div className="panel" style={{ marginTop: 14 }}>
          <ul className="list">
            {items.map(({ s, st }) => {
              const nights = nightsAt(data, s);
              const label = st.day ? `Day ${nights.map(n => n.day).join(', ')} · ${fmtDate(st.day.date)} (${relativeDay(st.day.date)})` : 'Not on the itinerary';
              return (
                <li key={s.id}>
                  <a className="row" href={'#/stayover/' + encodeURIComponent(s.id)}>
                    <span className="ic" style={s.confirmed ? { background: 'var(--ok-bg)', color: 'var(--ok)' } : st.status === 'due' ? { background: 'var(--warn-bg)', color: 'var(--warn)' } : undefined}>
                      <Icon name={s.confirmed ? 'check' : st.status === 'due' ? 'phone' : 'bed'} />
                    </span>
                    <div className="grow">
                      <div className="t">{s.name}</div>
                      <div className="s">{label}</div>
                      <div className="s">{s.confirmed ? `Confirmed by ${s.confirmedBy}` : s.caller ? `Caller: ${s.caller}` : 'No caller assigned'}</div>
                    </div>
                    {st.status === 'due' && hasName(s.caller, me.name) && <Tag tone="warn">Your call</Tag>}
                    <Icon name="chevR" className="chev" />
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      </main>
    </>
  );
}

export function StayoverDetail({ id }: { id: string }) {
  const { data } = useBoot();
  const { me } = useSession();
  const [sheet, setSheet] = useState<'call' | 'edit' | null>(null);
  const { rows } = useRows('Reports');
  if (!data || !me) return null;
  const s = data.stayovers.find(x => x.id === id);
  if (!s) return <><TopBar title="Stayover" backTo="/stayovers" /><div className="wrap"><Empty icon="bed">That stayover is not in the sheet anymore.</Empty></div></>;
  const nights = nightsAt(data, s);
  const st = callStatus(data, s);
  const label = st.day ? `Day ${nights.map(n => n.day).join(', ')} · ${fmtDate(st.day.date)} (${relativeDay(st.day.date)})` : '';
  const canEdit = me.role !== 'rider' || hasName(s.caller, me.name);
  const comments = rows.filter(r => r.category === 'Stayover comment' && nights.some(n => n.day === r.day));
  return (
    <>
      <TopBar title={s.name} backTo="/stayovers" />
      <main className="wrap">
        <p className="muted" style={{ marginTop: 14 }}>{label}</p>
        <StayoverCard stay={s} data={data} openCall={() => setSheet('call')} full />
        <section className="sec">
          <h2>Confirmation call</h2>
          <div className="panel pad">
            <div>Caller: <b>{s.caller || 'nobody yet'}</b></div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
              <button className="btn small ok" onClick={() => setSheet('call')}><Icon name="phone" size={16} />{s.confirmed ? 'Call notes' : 'Call and confirm'}</button>
              {!hasName(s.caller, me.name) && <button className="btn small" onClick={() => { void mutate('claimCall', { id: s.id }, 'Claim stayover call'); toast("You're now the caller for this stayover."); }}>I'll make this call</button>}
              {canEdit && <button className="btn small quiet" onClick={() => setSheet('edit')}><Icon name="pen" size={16} />Edit info</button>}
            </div>
          </div>
        </section>
        {comments.length > 0 && (
          <section className="sec">
            <h2>Rider comments</h2>
            <div className="panel">
              {comments.map(r => (
                <div key={r.id} className="entry"><div className="meta"><Avatar name={r.author} size={24} />{r.author} · {fmtTime(r.timestamp)}</div><div className="text">{r.text}</div></div>
              ))}
            </div>
          </section>
        )}
      </main>
      {sheet === 'call' && <StayoverCallSheet stayover={s} dayLabel={label} onClose={() => setSheet(null)} />}
      {sheet === 'edit' && <StayoverEditSheet stayover={s} onClose={() => setSheet(null)} />}
    </>
  );
}
