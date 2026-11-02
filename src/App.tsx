import { useEffect, useState } from 'react';
import { Icon } from './components/Icon';
import { Toaster, useRoute } from './components/ui';
import { isoLocal } from './lib/dates';
import { jobsFor, openJobCount } from './lib/jobs';
import { loadCachedBoot, refreshBoot, todayDay, useBoot, useOutbox, useSession } from './lib/store';
import { kick } from './lib/sync';
import { DayScreen } from './screens/DayScreen';
import { FormsScreen } from './screens/Forms';
import { InstallScreen } from './screens/Install';
import { InterviewDetail, InterviewsScreen } from './screens/Interviews';
import { JournalScreen } from './screens/Journal';
import { MoneyScreen } from './screens/Money';
import { MoreScreen, ReportsScreen, SettingsScreen, TeamScreen } from './screens/More';
import { PhotosScreen } from './screens/Photos';
import { RouteScreen } from './screens/Route';
import { SignIn } from './screens/SignIn';
import { StayoverDetail, StayoversScreen } from './screens/Stayovers';
import { VanScreen } from './screens/Van';

export function App() {
  const { me } = useSession();
  const { data, error } = useBoot();
  const route = useRoute();
  const ops = useOutbox();
  const online = useOnline();

  useEffect(() => {
    if (!me) return;
    void loadCachedBoot().then(() => refreshBoot());
    kick();
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - (lastRefresh.at || 0) > 2 * 60 * 1000) { lastRefresh.at = Date.now(); void refreshBoot(); }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [me?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  // App icon badge = open jobs today (iPhone 16.4+ and Android, once installed).
  const jobs = data && me ? jobsFor(data, me.name, todayDay(data.itinerary), isoLocal()) : [];
  const openJobs = openJobCount(jobs);
  useEffect(() => {
    const nav = navigator as Navigator & { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    if (openJobs) nav.setAppBadge?.(openJobs).catch(() => {}); else nav.clearAppBadge?.().catch(() => {});
  }, [openJobs]);

  if (!me) return <><SignIn /><Toaster /></>;

  const [a, b] = route.parts;
  let screen: React.ReactNode;
  let tab = 'today';
  switch (a) {
    case undefined: screen = <DayScreen />; break;
    case 'day': screen = <DayScreen key={b} dayNum={Number(b)} />; tab = 'route'; break;
    case 'route': screen = <RouteScreen />; tab = 'route'; break;
    case 'photos': screen = <PhotosScreen dayParam={route.query.get('day')} />; tab = 'photos'; break;
    case 'journal': screen = <JournalScreen />; tab = 'journal'; break;
    case 'stayovers': screen = <StayoversScreen />; tab = 'more'; break;
    case 'stayover': screen = <StayoverDetail id={decodeURIComponent(b || '')} />; tab = 'more'; break;
    case 'van': screen = <VanScreen />; tab = 'more'; break;
    case 'money': screen = <MoneyScreen tab={b} key={b || 'r'} />; tab = 'more'; break;
    case 'interviews': screen = <InterviewsScreen />; tab = 'more'; break;
    case 'interview': screen = <InterviewDetail id={b || ''} />; tab = 'more'; break;
    case 'reports': screen = <ReportsScreen />; tab = 'more'; break;
    case 'team': screen = <TeamScreen />; tab = 'more'; break;
    case 'settings': screen = <SettingsScreen />; tab = 'more'; break;
    case 'install': screen = <InstallScreen />; tab = 'more'; break;
    case 'forms': screen = <FormsScreen tab={b} key={b || 'mine'} />; tab = 'more'; break;
    default: screen = <MoreScreen />; tab = 'more';
  }
  if (a === 'more') tab = 'more';

  return (
    <div className="app">
      {!online && <div className="offline">No signal. Everything you add is saved and uploads later{ops.length ? ` (${ops.length} waiting)` : ''}.</div>}
      {online && error && !data && <div className="offline">Could not load the itinerary: {error}</div>}
      {screen}
      <div className="tabbar">
        <nav aria-label="Main">
          <Tab href="#/" icon="today" label="Today" on={tab === 'today'} count={openJobs} />
          <Tab href="#/route" icon="route" label="Route" on={tab === 'route'} />
          <Tab href="#/photos" icon="photo" label="Photos" on={tab === 'photos'} />
          <Tab href="#/journal" icon="journal" label="Journal" on={tab === 'journal'} />
          <Tab href="#/more" icon="more" label="More" on={tab === 'more'} count={ops.filter(o => o.error).length || undefined} />
        </nav>
      </div>
      <Toaster />
    </div>
  );
}

const lastRefresh = { at: 0 };

function Tab({ href, icon, label, on, count }: { href: string; icon: string; label: string; on: boolean; count?: number }) {
  return (
    <a href={href} className={on ? 'on' : ''} aria-current={on ? 'page' : undefined}>
      <Icon name={icon} size={24} />
      {label}
      {count ? <span className="count">{count}</span> : null}
    </a>
  );
}

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);
  return online;
}
