import { useState } from 'react';
import type { Day } from '../api/types';
import { Icon } from '../components/Icon';
import { GasSheet, ReportSheet, SwapDriverSheet } from '../components/forms';
import { Tag, TopBar } from '../components/ui';
import { fmtDate, fmtDateTime, isoLocal } from '../lib/dates';
import { hasName } from '../lib/jobs';
import { money } from '../lib/media';
import { todayDay, useBoot, useRows, useSession } from '../lib/store';

export function VanScreen() {
  const { data } = useBoot();
  const { me } = useSession();
  const gas = useRows('Gas');
  const swaps = useRows('DriverSwaps');
  const [sheet, setSheet] = useState<{ t: 'swap'; d: Day } | { t: 'gas' } | { t: 'accident' } | null>(null);
  const [showPast, setShowPast] = useState(false);
  if (!data || !me) return null;
  const today = isoLocal();
  const current = todayDay(data.itinerary);
  const days = data.itinerary.filter(d => showPast || d.date >= today);

  const fills = [...gas.rows].sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
  const gallons = fills.reduce((s, g) => s + Number(g.gallons || 0), 0);
  const spent = fills.reduce((s, g) => s + Number(g.total || 0), 0);
  const odos = fills.filter(g => g.odometer !== '' && g.odometer !== undefined).map(g => ({ o: Number(g.odometer), gal: Number(g.gallons) }));
  let mpg: number | null = null;
  if (odos.length >= 2) {
    const miles = odos[odos.length - 1].o - odos[0].o;
    const gal = odos.slice(1).reduce((s, x) => s + x.gal, 0);
    if (miles > 0 && gal > 0) mpg = miles / gal;
  }

  return (
    <>
      <TopBar title="Van" backTo="/more" />
      <main className="wrap">
        <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
          <button className="btn primary" onClick={() => setSheet({ t: 'gas' })}><Icon name="gas" size={18} />Log gas</button>
          <button className="btn danger" onClick={() => setSheet({ t: 'accident' })}><Icon name="sos" size={18} />Report accident</button>
        </div>

        <section className="sec">
          <h2>Driver rotation <span className="aside"><button className="btn small quiet" onClick={() => setShowPast(!showPast)}>{showPast ? 'Hide past' : 'Show past'}</button></span></h2>
          <div className="panel">
            <ul className="list">
              {days.map(d => (
                <li key={d.day} className="row">
                  <span className="ic" style={d.day === current?.day ? { background: 'var(--orange)', color: '#fff' } : undefined}><b style={{ fontFamily: 'var(--display)', fontSize: 19 }}>{d.day}</b></span>
                  <div className="grow">
                    <div className="t">{d.driver || 'No driver'} {hasName(d.driver, me.name) && <Tag tone="orange">You</Tag>}</div>
                    <div className="s">{fmtDate(d.date)} · {d.restDay ? 'Rest day' : `${d.from.split(',')[0]} → ${d.to.split(',')[0]}`}</div>
                  </div>
                  {d.date >= today && <button className="btn small" onClick={() => setSheet({ t: 'swap', d })}>Change</button>}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="sec">
          <h2>Gas</h2>
          <div className="stat-row">
            <div><div className="v">{gallons.toFixed(1)}</div><div className="k">gallons</div></div>
            <div><div className="v">{money(spent).replace('.00', '')}</div><div className="k">spent</div></div>
            <div><div className="v">{mpg ? mpg.toFixed(1) : '–'}</div><div className="k">mpg (from odometer)</div></div>
          </div>
          <div className="panel" style={{ marginTop: 10 }}>
            {gas.rows.length === 0 && <div className="pad muted" style={{ padding: 16 }}>No fill-ups logged yet.</div>}
            <ul className="list">
              {gas.rows.map(g => (
                <li key={g.id} className="row">
                  <span className="ic"><Icon name="gas" /></span>
                  <div className="grow">
                    <div className="t">{money(g.total)} · {Number(g.gallons).toFixed(1)} gal @ {money(g.pricePerGallon)}</div>
                    <div className="s">Day {g.day} · {g.driver}{g.station ? ` · ${g.station}` : ''}{g.paidWith ? ` · ${g.paidWith}` : ''}</div>
                  </div>
                  {g._pending ? <Tag>Syncing</Tag> : g.receiptLink ? <a className="btn small quiet" href={String(g.receiptLink).split('\n')[0]} target="_blank" rel="noreferrer">Receipt</a> : null}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {swaps.rows.length > 0 && (
          <section className="sec">
            <h2>Driver changes</h2>
            <div className="panel">
              {swaps.rows.slice(0, 20).map(s => (
                <div key={s.id} className="entry">
                  <div className="meta">Day {s.day} · {fmtDateTime(s.timestamp)} · by {s.changedBy}</div>
                  <div className="text">{s.fromDriver || 'Nobody'} → <b>{s.toDriver}</b>{s.reason ? ` (${s.reason})` : ''}</div>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
      {sheet?.t === 'swap' && <SwapDriverSheet day={sheet.d} onClose={() => setSheet(null)} />}
      {sheet?.t === 'gas' && <GasSheet day={current?.day ?? 1} onClose={() => setSheet(null)} />}
      {sheet?.t === 'accident' && <ReportSheet day={current?.day ?? 1} category="Van accident" onClose={() => setSheet(null)} />}
    </>
  );
}
