import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { TopBar } from '../components/ui';
import { isIOS } from '../lib/media';
import { useSession } from '../lib/store';

interface BIPEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
let deferred: BIPEvent | null = null;
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e as BIPEvent; });
}

export function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function InstallScreen() {
  const { me } = useSession();
  const ios = isIOS();
  const [platform, setPlatform] = useState<'ios' | 'android'>(ios ? 'ios' : 'android');
  const [canPrompt, setCanPrompt] = useState(!!deferred);
  useEffect(() => {
    const on = () => setCanPrompt(true);
    window.addEventListener('beforeinstallprompt', on);
    return () => window.removeEventListener('beforeinstallprompt', on);
  }, []);
  const installed = isStandalone();
  const topic = me?.notifyTopic;

  return (
    <>
      <TopBar title="Install on your phone" backTo="/more" />
      <main className="wrap">
        {installed ? (
          <div className="banner ok" style={{ marginTop: 16 }}><Icon name="check" /><div>You're using the installed app. Nothing else to do.</div></div>
        ) : (
          <p className="muted" style={{ marginTop: 16 }}>No app store needed. Add this page to your home screen and it opens full screen like any other app, works offline, and keeps your uploads going.</p>
        )}
        <div className="seg" style={{ marginTop: 12 }}>
          <button className={platform === 'ios' ? 'on' : ''} onClick={() => setPlatform('ios')}>iPhone</button>
          <button className={platform === 'android' ? 'on' : ''} onClick={() => setPlatform('android')}>Android</button>
        </div>

        {platform === 'ios' ? (
          <ol className="panel steps">
            <li><b>Open this page in Safari.</b> Other browsers on iPhone can't add apps to the home screen on older iOS versions, so Safari is the safe choice.</li>
            <li>Tap the <b>Share</b> button (the square with an arrow pointing up) in the toolbar.</li>
            <li>Scroll down and tap <b>Add to Home Screen</b>. If you don't see it, tap <b>Edit Actions</b> and add it.</li>
            <li>Keep the name "Ride Day" and tap <b>Add</b>.</li>
            <li>Open the app from the new icon on your home screen and sign in once. (The home screen app has its own sign-in, separate from Safari.)</li>
          </ol>
        ) : (
          <>
            {canPrompt && !installed && (
              <button className="btn primary block" style={{ marginTop: 14 }} onClick={async () => { await deferred?.prompt(); deferred = null; setCanPrompt(false); }}>
                <Icon name="download" size={18} />Install the app now
              </button>
            )}
            <ol className="panel steps">
              <li><b>Open this page in Chrome.</b></li>
              <li>Tap the <b>⋮ menu</b> in the top right corner.</li>
              <li>Tap <b>Install app</b> (on some phones it says <b>Add to Home screen</b>), then <b>Install</b>.</li>
              <li>Open the app from your home screen or app drawer and sign in.</li>
            </ol>
          </>
        )}

        <section className="sec">
          <h2>Get your morning reminder</h2>
          <div className="panel pad stack">
            <p style={{ margin: 0 }}>Every morning the app sends your jobs for the day: driving, calls to make, blog post and so on.</p>
            <p style={{ margin: 0 }}><b>By email:</b> ask a leader to add your email in the Riders tab.</p>
            <p style={{ margin: 0 }}><b>As a phone notification:</b> install the free <b>ntfy</b> app (App Store or Google Play), tap +, and subscribe to {topic ? <>your topic <b style={{ overflowWrap: 'anywhere' }}>{topic}</b></> : 'a topic name a leader gives you (it goes in the "Notify Topic" column of the Riders tab)'}. Pick a hard-to-guess name: anyone who knows it can read the notifications.</p>
          </div>
        </section>
        <section className="sec">
          <h2>Good to know</h2>
          <div className="panel pad stack small">
            <p style={{ margin: 0 }}>Things you add without signal are saved on the phone and upload by themselves once you're back online. The Settings & sync screen shows what's waiting.</p>
            <p style={{ margin: 0 }}>Big videos upload in pieces. If you close the app, the upload picks up where it stopped next time you open it.</p>
            <p style={{ margin: 0 }}>Allow camera, microphone and location when the app asks, so you can take photos, record interviews and attach locations to reports.</p>
          </div>
        </section>
      </main>
    </>
  );
}
