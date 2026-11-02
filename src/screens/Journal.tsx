import { useEffect, useMemo, useState } from 'react';
import type { Journal } from '../api/types';
import { Icon } from '../components/Icon';
import { JournalSheet } from '../components/forms';
import { Avatar, Empty, Tag, TopBar, toast } from '../components/ui';
import { idb } from '../lib/db';
import { fmtDate, fmtDateTime } from '../lib/dates';
import { todayDay, useBoot, useRows, useSession, phoneJournalKey } from '../lib/store';
import { enqueueCall } from '../lib/sync';

function usePhoneJournal(): Journal[] {
  const [list, setList] = useState<Journal[]>([]);
  useEffect(() => {
    const load = () => void idb.get<Journal[]>('local', phoneJournalKey()).then(l => setList(l || []));
    load();
    window.addEventListener('phone-journal', load);
    return () => window.removeEventListener('phone-journal', load);
  }, []);
  return list;
}

export function JournalScreen() {
  const { data } = useBoot();
  const { me } = useSession();
  const { rows, loading } = useRows('Journals');
  const phone = usePhoneJournal();
  const [tab, setTab] = useState<'team' | 'mine'>('team');
  const [edit, setEdit] = useState<Journal | 'new' | null>(null);
  const current = data ? todayDay(data.itinerary) : undefined;

  const list = useMemo(() => {
    if (tab === 'team') return rows.filter(j => j.visibility === 'shared');
    return [...rows.filter(j => j.author === me?.name), ...phone].sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
  }, [tab, rows, phone, me]);

  const byDay = useMemo(() => {
    const g = new Map<number, Journal[]>();
    for (const j of list) g.set(j.day, [...(g.get(j.day) || []), j]);
    return [...g.entries()].sort((a, b) => b[0] - a[0]);
  }, [list]);

  const remove = async (j: Journal) => {
    if (!confirm('Delete this entry?')) return;
    if (j.visibility === 'phone') {
      await idb.set('local', phoneJournalKey(), phone.filter(x => x.id !== j.id));
      window.dispatchEvent(new Event('phone-journal'));
    } else {
      await enqueueCall('remove', { sheet: 'Journals', id: j.id }, 'Delete journal entry');
    }
    toast('Deleted.');
  };

  if (!data || !me) return null;
  return (
    <>
      <TopBar title="Journal" right={<button className="iconbtn" aria-label="New entry" onClick={() => setEdit('new')}><Icon name="plus" /></button>} />
      <main className="wrap">
        <div className="seg" style={{ marginTop: 16 }}>
          <button className={tab === 'team' ? 'on' : ''} onClick={() => setTab('team')}>Team journal</button>
          <button className={tab === 'mine' ? 'on' : ''} onClick={() => setTab('mine')}>My journal</button>
        </div>
        {list.length === 0 && !loading && (
          <Empty icon="journal">
            {tab === 'team' ? 'Nobody has shared an entry yet. Start the team journal.' : 'Your personal entries show up here. Choose "Just me" or "This phone only" when writing.'}
            <div><button className="btn primary" onClick={() => setEdit('new')}>Write about Day {current?.day ?? 1}</button></div>
          </Empty>
        )}
        {byDay.map(([d, entries]) => {
          const day = data.itinerary.find(x => x.day === d);
          return (
            <div key={d}>
              <div className="dayhead">Day {d} <span>{day ? `${fmtDate(day.date)} · ${day.from.split(',')[0]} → ${day.to.split(',')[0]}` : ''}</span></div>
              <div className="panel">
                {entries.map(j => (
                  <article key={j.id} className="entry">
                    <div className="meta">
                      <Avatar name={j.author} size={26} />
                      <span style={{ flex: 1 }}>{j.author} · {fmtDateTime(j.timestamp)}</span>
                      {j.visibility === 'private' && <Tag><Icon name="lock" size={12} />Just me</Tag>}
                      {j.visibility === 'phone' && <Tag><Icon name="lock" size={12} />This phone</Tag>}
                      {j._pending && <Tag>Waiting to sync</Tag>}
                    </div>
                    {j.title && <div className="title">{j.title}</div>}
                    <div className="text">{j.text}</div>
                    {j.author === me.name && (
                      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                        <button className="btn small quiet" onClick={() => setEdit(j)}>Edit</button>
                        <button className="btn small quiet" onClick={() => void remove(j)}>Delete</button>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </div>
          );
        })}
      </main>
      {edit && <JournalSheet day={edit === 'new' ? current?.day ?? 1 : edit.day} entry={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </>
  );
}
