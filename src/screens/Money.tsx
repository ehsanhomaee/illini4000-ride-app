import { useState } from 'react';
import { Icon } from '../components/Icon';
import { DonationSheet, ExpenseSheet } from '../components/forms';
import { Empty, Tag, TopBar, toast } from '../components/ui';
import { fmtDate } from '../lib/dates';
import { money } from '../lib/media';
import { todayDay, useBoot, useRows, useSession } from '../lib/store';
import { enqueueCall } from '../lib/sync';

export function MoneyScreen({ tab: initial }: { tab?: string }) {
  const { data } = useBoot();
  const { me } = useSession();
  const [tab, setTab] = useState<'receipts' | 'donations'>(initial === 'donations' ? 'donations' : 'receipts');
  const exp = useRows('Expenses');
  const gas = useRows('Gas');
  const don = useRows('Donations');
  const [sheet, setSheet] = useState<'expense' | 'donation' | null>(null);
  const [onlyOpen, setOnlyOpen] = useState(false);
  if (!data || !me) return null;
  const current = todayDay(data.itinerary);
  const dayDate = (n: number) => data.itinerary.find(d => d.day === n)?.date || '';

  const spent = exp.rows.reduce((s, e) => s + Number(e.amount || 0), 0) + gas.rows.reduce((s, g) => s + Number(g.total || 0), 0);
  const owed = exp.rows.filter(e => e.reimburseTo).reduce((s, e) => s + Number(e.amount || 0), 0)
    + gas.rows.filter(g => String(g.paidWith).startsWith('Paid myself')).reduce((s, g) => s + Number(g.total || 0), 0);
  const given = don.rows.reduce((s, d) => s + Number(d.amount || 0), 0);
  const unthanked = don.rows.filter(d => !d.thankYouSent);

  const markThanked = async (id: string) => {
    await enqueueCall('update', { sheet: 'Donations', id, patch: { thankYouSent: true } }, 'Thank-you sent');
    toast('Marked as thanked.');
  };

  return (
    <>
      <TopBar title="Receipts & donations" backTo="/more" />
      <main className="wrap">
        <div className="seg" style={{ marginTop: 16 }}>
          <button className={tab === 'receipts' ? 'on' : ''} onClick={() => setTab('receipts')}>Receipts</button>
          <button className={tab === 'donations' ? 'on' : ''} onClick={() => setTab('donations')}>Donations</button>
        </div>

        {tab === 'receipts' ? (
          <>
            <div className="stat-row" style={{ marginTop: 14 }}>
              <div><div className="v">{money(spent).replace('.00', '')}</div><div className="k">spent incl. gas</div></div>
              <div><div className="v">{money(owed).replace('.00', '')}</div><div className="k">to reimburse</div></div>
              <div><div className="v">{exp.rows.length + gas.rows.length}</div><div className="k">receipts</div></div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
              <button className="btn primary" onClick={() => setSheet('expense')}><Icon name="receipt" size={18} />Add receipt</button>
              <button className={'btn' + (onlyOpen ? ' navy' : '')} onClick={() => setOnlyOpen(!onlyOpen)}>Reimbursements only</button>
            </div>
            {exp.rows.length === 0 && <Empty icon="receipt">No receipts yet. Snap them right at the register so nothing gets lost.</Empty>}
            <div className="panel" style={{ marginTop: 14 }}>
              <ul className="list">
                {exp.rows.filter(e => !onlyOpen || e.reimburseTo).map(e => (
                  <li key={e.id} className="row">
                    <span className="ic"><Icon name="receipt" /></span>
                    <div className="grow">
                      <div className="t">{money(e.amount)} · {e.vendor || e.category}</div>
                      <div className="s">Day {e.day} · {fmtDate(dayDate(e.day))} · {e.category} · {e.recordedBy}</div>
                      {e.reimburseTo && <div className="s" style={{ color: 'var(--warn)' }}>Reimburse {e.reimburseTo}</div>}
                    </div>
                    {e._pending ? <Tag>Syncing</Tag> : e.receiptLink ? <a className="btn small quiet" href={String(e.receiptLink).split('\n')[0]} target="_blank" rel="noreferrer">Photo</a> : <Tag tone="warn">No photo</Tag>}
                  </li>
                ))}
              </ul>
            </div>
            <p className="tiny" style={{ marginTop: 10 }}>Gas fill-ups are on the Van screen and counted in the totals above.</p>
          </>
        ) : (
          <>
            <div className="stat-row" style={{ marginTop: 14 }}>
              <div><div className="v">{don.rows.length}</div><div className="k">donations</div></div>
              <div><div className="v">{money(given).replace('.00', '')}</div><div className="k">value recorded</div></div>
              <div><div className="v">{unthanked.length}</div><div className="k">need a thank-you</div></div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
              <button className="btn primary" onClick={() => setSheet('donation')}><Icon name="heart" size={18} />Record donation</button>
              <button className={'btn' + (onlyOpen ? ' navy' : '')} onClick={() => setOnlyOpen(!onlyOpen)}>Needs thank-you</button>
            </div>
            {don.rows.length === 0 && <Empty icon="heart">No donations recorded yet. Meals and places to sleep count too.</Empty>}
            <div className="panel" style={{ marginTop: 14 }}>
              <ul className="list">
                {don.rows.filter(d => !onlyOpen || !d.thankYouSent).map(d => (
                  <li key={d.id} className="row">
                    <span className="ic"><Icon name="heart" /></span>
                    <div className="grow">
                      <div className="t">{d.donor}{d.amount !== '' && d.amount !== undefined ? ` · ${money(d.amount)}` : ''}</div>
                      <div className="s">{d.type}{d.description ? ` · ${d.description}` : ''}</div>
                      <div className="s">Day {d.day} · {d.recordedBy}{d.donorContact ? ` · ${d.donorContact}` : ''}</div>
                    </div>
                    {d.thankYouSent ? <Tag tone="ok">Thanked</Tag> : <button className="btn small" onClick={() => void markThanked(d.id)}>Thanked</button>}
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </main>
      {sheet === 'expense' && <ExpenseSheet day={current?.day ?? 1} onClose={() => setSheet(null)} />}
      {sheet === 'donation' && <DonationSheet day={current?.day ?? 1} onClose={() => setSheet(null)} />}
    </>
  );
}
