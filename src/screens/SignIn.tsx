import { useState } from 'react';
import { call, isDemo, teamName } from '../api/client';
import { DEMO_TEAM_CODE } from '../api/demo';
import type { Rider, Role } from '../api/types';
import { Icon } from '../components/Icon';
import { Field, toast, useBusy } from '../components/ui';
import { prefs } from '../lib/db';
import { signedIn } from '../lib/store';

export function SignIn() {
  const [code, setCode] = useState(prefs.get('teamCode', isDemo() ? DEMO_TEAM_CODE : ''));
  const [people, setPeople] = useState<{ name: string; role: Role }[] | null>(null);
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [busy, run] = useBusy();

  const loadNames = () => run(async () => {
    const list = await call<{ name: string; role: Role }[]>('riders', { teamCode: code });
    prefs.set('teamCode', code);
    setPeople(list.sort((a, b) => a.name.localeCompare(b.name)));
  });
  const login = () => run(async () => {
    const r = await call<{ token: string; me: Rider }>('login', { teamCode: code, name, pin });
    signedIn(r.token, r.me);
    toast(`Welcome, ${r.me.name.split(' ')[0]}!`);
  });

  return (
    <div className="signin">
      <div className="wrap hero">
        <div className="mark">{teamName()}<span>Ride day</span></div>
        <p>Today's route, your jobs, the van, tonight's stayover, and every photo and receipt from the road.</p>
      </div>
      <div className="card">
        <div className="wrap">
          {isDemo() && (
            <div className="banner info" style={{ marginTop: 16 }}>
              <Icon name="flag" />
              <div>This is a demo with made-up riders and stops. The team code is <b>demo</b>; pick any name and any 4-digit PIN.</div>
            </div>
          )}
          {!people ? (
            <form onSubmit={e => { e.preventDefault(); void loadNames(); }}>
              <Field label="Team code" hint="Your trip leaders share this. You only type it once.">
                <input value={code} onChange={e => setCode(e.target.value)} autoCapitalize="none" autoCorrect="off" autoComplete="off" />
              </Field>
              <button className="btn primary block" style={{ marginTop: 16 }} disabled={!code.trim() || busy}>{busy ? 'Checking…' : 'Continue'}</button>
            </form>
          ) : (
            <form onSubmit={e => { e.preventDefault(); void login(); }}>
              <div className="sec" style={{ marginTop: 18 }}>
                <h2>Who are you?</h2>
                <div className="names">
                  {people.map(p => (
                    <button type="button" key={p.name} className={'chip' + (name === p.name ? ' on' : '')} onClick={() => setName(p.name)}>{p.name}</button>
                  ))}
                </div>
                {!people.length && <p className="muted">No riders yet. A leader needs to add names to the Riders tab of the sheet.</p>}
              </div>
              {name && (
                <>
                  <Field label="PIN" hint="First time? Pick any 4 to 8 digits; that becomes your PIN. Forgot it? A leader can reset it.">
                    <input value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} inputMode="numeric" type="password" autoComplete="current-password" maxLength={8} />
                  </Field>
                  <button className="btn primary block" style={{ marginTop: 16 }} disabled={pin.length < 4 || busy}>{busy ? 'Signing in…' : `Sign in as ${name.split(' ')[0]}`}</button>
                </>
              )}
              <button type="button" className="btn quiet block" style={{ marginTop: 10 }} onClick={() => { setPeople(null); setName(''); }}>Use a different team code</button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
