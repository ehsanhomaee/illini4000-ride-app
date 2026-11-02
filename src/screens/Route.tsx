import { useState } from 'react';
import type { Day } from '../api/types';
import { Icon } from '../components/Icon';
import { Empty, Tag, TopBar } from '../components/ui';
import { fmtDate, isoLocal } from '../lib/dates';
import { hasName } from '../lib/jobs';
import { useBoot, useSession } from '../lib/store';

export function RouteScreen() {
  const { data } = useBoot();
  const { me } = useSession();
  const [mine, setMine] = useState<'all' | 'driving' | 'jobs'>('all');
  if (!data || !me) return null;
  const today = isoLocal();
  const it = data.itinerary;
  const total = it.reduce((s, d) => s + Number(d.routeMiles !== '' ? d.routeMiles : d.plannedMiles || 0), 0);
  const done = it.filter(d => d.date < today).reduce((s, d) => s + Number(d.routeMiles !== '' ? d.routeMiles : d.plannedMiles || 0), 0);
  const myDuties = new Set(data.duties.filter(j => hasName(j.person, me.name) && j.person.toLowerCase() !== 'everyone').map(j => j.day));
  const list = it.filter(d => mine === 'all' || (mine === 'driving' ? hasName(d.driver, me.name) : myDuties.has(d.day) || hasName(d.routeLeader, me.name)));
  const stays = new Map(data.stayovers.map(s => [s.id, s]));

  return (
    <>
      <TopBar title="The route" />
      <main className="wrap">
        <div className="stat-row" style={{ marginTop: 16 }}>
          <div><div className="v">{it.length}</div><div className="k">days</div></div>
          <div><div className="v">{Math.round(total).toLocaleString()}</div><div className="k">total miles</div></div>
          <div><div className="v">{Math.round(done).toLocaleString()}</div><div className="k">miles ridden</div></div>
        </div>
        <div className="seg" style={{ marginTop: 16 }}>
          <button className={mine === 'all' ? 'on' : ''} onClick={() => setMine('all')}>All days</button>
          <button className={mine === 'driving' ? 'on' : ''} onClick={() => setMine('driving')}>I drive</button>
          <button className={mine === 'jobs' ? 'on' : ''} onClick={() => setMine('jobs')}>My jobs</button>
        </div>
        {list.length === 0 && <Empty icon="route">{mine === 'driving' ? 'You are not on the van rotation yet.' : mine === 'jobs' ? 'No jobs assigned to you yet.' : 'No days in the itinerary yet.'}</Empty>}
        <div className="panel" style={{ marginTop: 14 }}>
          <ul className="list">
            {list.map(d => <DayRow key={d.day} d={d} today={today} stayConfirmed={stays.get(d.stayoverId)?.confirmed} stayName={stays.get(d.stayoverId)?.name} me={me.name} />)}
          </ul>
        </div>
      </main>
    </>
  );
}

function DayRow({ d, today, stayConfirmed, stayName, me }: { d: Day; today: string; stayConfirmed?: boolean; stayName?: string; me: string }) {
  const miles = d.routeMiles !== '' ? d.routeMiles : d.plannedMiles;
  const isToday = d.date === today;
  const past = d.date < today;
  return (
    <li>
      <a className="row" href={'#/day/' + d.day} style={past ? { opacity: 0.62 } : undefined}>
        <span className="ic" style={isToday ? { background: 'var(--orange)', color: '#fff' } : undefined}>
          <b style={{ fontFamily: 'var(--display)', fontSize: 20 }}>{d.day}</b>
        </span>
        <div className="grow">
          <div className="t">{d.restDay ? `Rest day · ${d.to.split(',')[0]}` : `${d.from.split(',')[0]} → ${d.to.split(',')[0]}`}</div>
          <div className="s">
            {fmtDate(d.date)}{!d.restDay && miles !== '' ? ` · ${d.routeMiles === '' ? '≈' : ''}${Math.round(Number(miles))} mi` : ''}
            {d.driver ? ` · ${hasName(d.driver, me) ? 'you drive' : d.driver.split(' ')[0]}` : ''}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
            {isToday && <Tag tone="orange">Today</Tag>}
            {stayName && (stayConfirmed ? <Tag tone="ok">Stay confirmed</Tag> : !past ? <Tag tone="warn">Stay not confirmed</Tag> : null)}
            {!d.restDay && !d.rwgpsLink && !past && <Tag>No route yet</Tag>}
          </div>
        </div>
        <Icon name="chevR" className="chev" />
      </a>
    </li>
  );
}
