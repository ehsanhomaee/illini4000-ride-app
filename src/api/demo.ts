// Demo mode: the whole backend, running on the phone with made-up data.
// Used when public/config.json has no apiUrl, so anyone can try the app
// before the Google Sheet is set up. Mirrors backend/Code.gs actions.

import { idb, getBlob, putBlob } from '../lib/db';
import { addDays, isoLocal, newId } from '../lib/dates';
import type { Bootstrap, Day, Duty, FormReq, Rider, Stayover } from './types';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const OWNER: Record<string, string> = {
  Checkins: 'rider', Journals: 'author', Reports: 'author', Gas: 'driver', Expenses: 'recordedBy',
  Donations: 'recordedBy', Interviews: 'interviewers', Media: 'uploader', Submissions: 'rider',
};
export const DEMO_TEAM_CODE = 'demo';

async function table<T = Row>(name: string): Promise<T[]> {
  await seed();
  return (await idb.get<T[]>('local', 'demo:' + name)) || [];
}
async function save(name: string, rows: unknown[]) {
  await idb.set('local', 'demo:' + name, rows);
}

function names(field: string): string[] {
  return String(field || '').split(/[,&/]| and /i).map(s => s.trim().toLowerCase()).filter(Boolean);
}
function hasName(field: string, name: string) {
  const l = names(field);
  return l.includes(name.toLowerCase()) || l.includes('everyone') || l.includes('all');
}

let seeding: Promise<void> | null = null;
function seed(): Promise<void> {
  if (!seeding) seeding = doSeed();
  return seeding;
}

const DEMO_FORMS: FormReq[] = [
  { id: 'F1', form: 'Liability waiver', description: 'The signed Illini 4000 waiver of liability.', required: true, templateLink: '', dueDate: '' },
  { id: 'F2', form: 'Media release', description: 'Permission for the team to use photos, video and interviews that include you.', required: true, templateLink: '', dueDate: '' },
  { id: 'F3', form: 'Health insurance card', description: 'Photos of the front and back of your card.', required: true, templateLink: '', dueDate: '' },
  { id: 'F4', form: 'Medical & emergency info', description: 'Allergies, medications, conditions and your emergency contact.', required: true, templateLink: '', dueDate: '' },
  { id: 'F5', form: 'Bike safety check', description: 'Tune-up sign-off from a bike shop before the ride.', required: false, templateLink: '', dueDate: '' },
];

async function seedForms() {
  if (await idb.get('local', 'demo:Forms')) return;
  const ago = (d: number) => new Date(Date.now() - d * 86400000).toISOString();
  const sub = (id: string, rider: string, f: FormReq, status: string, d: number, note = '') => ({
    id, timestamp: ago(d), day: 0, rider, formId: f.id, form: f.form, status, note, fileLink: '',
    reviewedBy: status === 'Submitted' ? '' : 'Avery Chen', reviewedAt: status === 'Submitted' ? '' : ago(d - 1),
  });
  const [w, m, ins, med] = DEMO_FORMS;
  await save('Forms', DEMO_FORMS);
  await save('Submissions', [
    sub('sub1', 'Sam Rivera', w, 'Approved', 30), sub('sub2', 'Sam Rivera', m, 'Approved', 30), sub('sub3', 'Sam Rivera', ins, 'Submitted', 2),
    sub('sub4', 'Maya Johnson', w, 'Approved', 25), sub('sub5', 'Maya Johnson', med, 'Needs redo', 6, 'Please add your emergency contact\'s phone number.'),
    sub('sub6', 'Leo Kim', w, 'Submitted', 1), sub('sub7', 'Priya Shah', w, 'Approved', 20), sub('sub8', 'Priya Shah', m, 'Approved', 20),
    sub('sub9', 'Priya Shah', ins, 'Approved', 20), sub('sub10', 'Priya Shah', med, 'Approved', 20, 'Paper copy'),
    sub('sub11', 'Avery Chen', w, 'Approved', 40), sub('sub12', 'Grace Lee', m, 'Submitted', 3),
  ]);
}

async function doSeed() {
  if (await idb.get('local', 'demo:Riders')) { await seedForms(); return; }
  const today = isoLocal();
  const start = addDays(today, -2); // today is Day 3
  const riders: Rider[] = [
    { name: 'Avery Chen', role: 'leader', phone: '2175550101', email: '', canDrive: true },
    { name: 'Jordan Patel', role: 'routemaster', phone: '2175550102', email: '', canDrive: true },
    { name: 'Sam Rivera', role: 'rider', phone: '2175550103', email: '', canDrive: true },
    { name: 'Maya Johnson', role: 'rider', phone: '2175550104', email: '', canDrive: false },
    { name: 'Leo Kim', role: 'rider', phone: '2175550105', email: '', canDrive: true },
    { name: 'Priya Shah', role: 'rider', phone: '2175550106', email: '', canDrive: true },
    { name: 'Noah Williams', role: 'rider', phone: '2175550107', email: '', canDrive: false },
    { name: 'Grace Lee', role: 'rider', phone: '2175550108', email: '', canDrive: true },
  ];
  const drivers = riders.filter(r => r.canDrive).map(r => r.name);
  const legs: [string, string, number, number, number, number, number, boolean?][] = [
    ['New York, NY', 'Princeton, NJ', 54, 40.7128, -74.006, 40.3573, -74.6672],
    ['Princeton, NJ', 'Philadelphia, PA', 48, 40.3573, -74.6672, 39.9526, -75.1652],
    ['Philadelphia, PA', 'Lancaster, PA', 72, 39.9526, -75.1652, 40.0379, -76.3055],
    ['Lancaster, PA', 'Harrisburg, PA', 45, 40.0379, -76.3055, 40.2732, -76.8867],
    ['Harrisburg, PA', 'Chambersburg, PA', 56, 40.2732, -76.8867, 39.9376, -77.6611],
    ['Chambersburg, PA', 'Cumberland, MD', 84, 39.9376, -77.6611, 39.6529, -78.7625],
    ['Cumberland, MD', 'Cumberland, MD', 0, 39.6529, -78.7625, 39.6529, -78.7625, true],
    ['Cumberland, MD', 'Confluence, PA', 62, 39.6529, -78.7625, 39.8098, -79.3542],
    ['Confluence, PA', 'Pittsburgh, PA', 72, 39.8098, -79.3542, 40.4406, -79.9959],
    ['Pittsburgh, PA', 'Wheeling, WV', 64, 40.4406, -79.9959, 40.064, -80.7209],
  ];
  const hosts = ['St. Paul Community Church', 'Riverside Friends Meeting House', 'Lancaster Mennonite School gym',
    'The Okafor family', 'Grace Lutheran Church', 'Allegany Rec Center', 'Allegany Rec Center',
    'River\'s Edge Campground', 'Pitt Hillel house', 'Wheeling YMCA'];
  const itinerary: Day[] = legs.map((l, i) => ({
    day: i + 1, date: addDays(start, i), from: l[0], to: l[1], plannedMiles: l[2] || '', rwgpsLink: '', routeMiles: '', elevationGainFt: '',
    startLat: l[3], startLon: l[4], endLat: l[5], endLon: l[6], stayoverId: i === 6 ? 'S6' : 'S' + (i + 1),
    driver: drivers[i % drivers.length], routeLeader: 'Jordan Patel', restDay: !!l[7],
    routeNotes: i === 2 ? 'Schuylkill River Trail for the first 25 miles. Lunch at Valley Forge. Watch the gravel section after mile 40.' : i === 6 ? 'Rest day. Laundry, bike tune-ups, and a team dinner at 6.' : '',
    notesFromPreviousRiders: i === 2 ? 'Last year: Route 23 shoulder is narrow near Elverson, ride single file. Great ice cream at the Amish market at mile 58.' :
      i === 5 ? 'Big climb over Sideling Hill. Regroup at the top, the descent is fast and the van can\'t stop on it.' : '',
  }));
  const stayovers: Stayover[] = itinerary.filter((_d, i) => i !== 6).map((d, i) => { const k = d.day - 1; return {
    id: d.stayoverId, name: hosts[k], address: '', city: d.to, lat: d.endLat, lon: d.endLon,
    contactName: ['Pastor Ruth', 'Dan Miller', 'Coach Ellis', 'Ada Okafor', 'Rev. Tom Berg', 'Kim Ford', 'Kim Ford', 'Joe Platt', 'Rachel Adler', 'Front desk'][k],
    contactPhone: '21755501' + String(50 + i), contactEmail: '',
    checkInTime: '4:00 PM', checkOutTime: '7:30 AM',
    dinner: ['Donated by the church potluck team', 'We cook (kitchen available)', 'Donated: pizza from Lancaster Rotary', 'Host family dinner', 'We cook', 'Donated by Allegany Lions Club', '', 'Campfire, we cook', 'Donated', 'Donated'][k] || '',
    breakfast: ['Bagels donated', 'Bring our own', 'Cereal + fruit provided', 'Host family breakfast', 'Bring our own', 'Donated', '', 'We cook', 'Bring our own', 'Donated'][k] || '',
    lunch: '', showers: ['2', '1', '6 (locker room)', '2', '0 (YMCA passes nearby)', '8', '', '4 (campground)', '3', '10'][k] || '',
    laundry: i % 2 ? 'Yes' : 'No', sleeping: i === 3 ? 'Beds and couches' : 'Floor (bring pads)', wifi: i % 3 ? 'Yes' : 'No',
    vanParking: 'Lot behind building', notes: i === 2 ? 'Enter through the side door by the gym. Shoes off on the gym floor.' : '',
    caller: ['Priya Shah', 'Priya Shah', 'Noah Williams', 'Noah Williams', 'Grace Lee', 'Grace Lee', '', 'Maya Johnson', 'Maya Johnson', 'Sam Rivera'][k] || 'Avery Chen',
    confirmed: d.day <= 4, confirmedBy: d.day <= 4 ? 'Avery Chen' : '', confirmedAt: d.day <= 4 ? new Date(Date.now() - 86400000 * (6 - d.day)).toISOString() : '',
    callNotes: d.day <= 4 ? 'Confirmed arrival around 4. Same contact as in the sheet.' : '',
  }; });
  const duties: Duty[] = [
    { id: 'j1', day: 3, person: 'Maya Johnson', duty: 'Write today\'s blog post', details: 'Due by 9 pm, send to Avery', done: false, doneBy: '', doneAt: '' },
    { id: 'j2', day: 3, person: 'Leo Kim', duty: 'Sweep: ride last and help with flats', details: '', done: false, doneBy: '', doneAt: '' },
    { id: 'j3', day: 3, person: 'Everyone', duty: 'Pump tires and check brakes before leaving', details: '', done: false, doneBy: '', doneAt: '' },
    { id: 'j4', day: 3, person: 'Priya Shah', duty: 'Thank-you card for tonight\'s host', details: 'Cards are in the van glovebox', done: false, doneBy: '', doneAt: '' },
    { id: 'j5', day: 3, person: 'Sam Rivera, Grace Lee', duty: 'Portrait interview at lunch stop', details: 'Bring the release forms', done: false, doneBy: '', doneAt: '' },
    { id: 'j6', day: 4, person: 'Noah Williams', duty: 'Write today\'s blog post', details: '', done: false, doneBy: '', doneAt: '' },
  ];
  const ts = (dayIdx: number, h: number) => { const d = new Date(start + 'T00:00:00'); d.setDate(d.getDate() + dayIdx); d.setHours(h); return d.toISOString(); };
  await save('Riders', riders);
  await save('Itinerary', itinerary);
  await save('Stayovers', stayovers);
  await save('Duties', duties);
  await save('Journals', [
    { id: 'jr1', timestamp: ts(1, 21), day: 2, author: 'Grace Lee', visibility: 'shared', title: 'Rose, bud, thorn', text: 'Rose: riding past Independence Hall at golden hour. Bud: first real hills tomorrow. Thorn: two flats before lunch.' },
    { id: 'jr2', timestamp: ts(0, 22), day: 1, author: 'Sam Rivera', visibility: 'shared', title: 'We actually left', text: 'Dipped our wheels in the Atlantic and rode out of the city. Everyone made it.' },
  ]);
  await save('Reports', [
    { id: 'r1', timestamp: ts(1, 15), day: 2, author: 'Leo Kim', category: 'Route comment', severity: 'Low', text: 'The detour on Main St adds 2 miles but avoids the bridge construction. Worth it.', lat: '', lon: '', details: '', status: 'Open', resolvedBy: '' },
  ]);
  await save('Checkins', [
    { id: 'c1', timestamp: ts(2, 7), day: 3, rider: 'Leo Kim', type: 'Left stayover', lat: '', lon: '', note: '' },
    { id: 'c2', timestamp: ts(2, 7), day: 3, rider: 'Priya Shah', type: 'Left stayover', lat: '', lon: '', note: '' },
  ]);
  await save('Gas', [
    { id: 'g1', timestamp: ts(1, 12), day: 2, driver: 'Jordan Patel', gallons: 18.2, pricePerGallon: 3.39, total: 61.7, odometer: 48210, station: 'Wawa, Trenton', paidWith: 'Team card', notes: '', receiptLink: '' },
  ]);
  await save('Donations', [
    { id: 'd1', timestamp: ts(1, 20), day: 2, recordedBy: 'Avery Chen', donor: 'Riverside Friends', donorContact: '', type: 'Food / meal', amount: '', description: 'Dinner and breakfast for 30', thankYouSent: false, notes: '', fileLink: '' },
  ]);
  for (const t of ['Expenses', 'Interviews', 'Media', 'DriverSwaps']) await save(t, []);
  await seedForms();
}

function riderPublic(r: Rider): Rider {
  return { ...r };
}

async function me(token: string): Promise<Rider> {
  const name = String(token || '').startsWith('demo.') ? token.slice(5) : '';
  const r = (await table<Rider>('Riders')).find(x => x.name === name);
  if (!r) throw new Error('AUTH: Please sign in again.');
  return r;
}

function isLeader(r: Rider) { return r.role === 'leader' || r.role === 'routemaster'; }

async function patch(name: string, key: string, id: unknown, p: Row): Promise<Row> {
  const rows = await table<Row>(name);
  const row = rows.find(r => String(r[key]) === String(id));
  if (!row) throw new Error('Could not find that row in ' + name + '.');
  Object.assign(row, p);
  await save(name, rows);
  return row;
}

export async function demoCall(action: string, req: Row): Promise<unknown> {
  await new Promise(r => setTimeout(r, 120)); // feel like a network
  switch (action) {
    case 'ping': return { pong: true };
    case 'riders': {
      if (String(req.teamCode || '').trim().toLowerCase() !== DEMO_TEAM_CODE) throw new Error('AUTH: In demo mode the team code is "demo".');
      return (await table<Rider>('Riders')).map(r => ({ name: r.name, role: r.role }));
    }
    case 'login': {
      if (String(req.teamCode || '').trim().toLowerCase() !== DEMO_TEAM_CODE) throw new Error('AUTH: In demo mode the team code is "demo".');
      if (!/^\d{4,8}$/.test(String(req.pin || ''))) throw new Error('AUTH: Your PIN must be 4 to 8 digits.');
      const r = (await table<Rider>('Riders')).find(x => x.name === req.name);
      if (!r) throw new Error('AUTH: That name is not in the Riders list.');
      return { token: 'demo.' + r.name, me: r };
    }
  }
  const user = await me(req.token);
  switch (action) {
    case 'bootstrap': {
      const out: Bootstrap = {
        config: { teamName: 'Illini 4000 (demo)', tripYear: String(new Date().getFullYear()), confirmDaysAhead: 5,
          emergencyInfo: 'Demo data. On the real trip this shows the team\'s emergency plan: call 911 first, then the trip leaders.' },
        me: user,
        riders: (await table<Rider>('Riders')).map(riderPublic),
        itinerary: await table<Day>('Itinerary'),
        stayovers: await table<Stayover>('Stayovers'),
        duties: await table<Duty>('Duties'),
        forms: await table<FormReq>('Forms'),
        submissions: (await table<Row>('Submissions')).filter(x => x.rider === user.name) as Bootstrap['submissions'],
      };
      return out;
    }
    case 'list': {
      let rows = await table<Row>(req.sheet);
      if (req.day !== undefined && req.day !== null && req.day !== '') rows = rows.filter(r => Number(r.day) === Number(req.day));
      if (req.sheet === 'Journals') rows = rows.filter(r => r.visibility !== 'private' || r.author === user.name);
      if (req.sheet === 'Submissions' && !isLeader(user)) rows = rows.filter(r => r.rider === user.name);
      if (req.sheet === 'Media' && !isLeader(user)) rows = rows.filter(r => r.kind !== 'rider-form' || r.uploader === user.name);
      return rows;
    }
    case 'add': {
      const rows = await table<Row>(req.sheet);
      const row = { ...req.row };
      if (rows.find(r => r.id === row.id)) return row;
      row.timestamp = row.timestamp || new Date().toISOString();
      const o = OWNER[req.sheet];
      if (o && (!row[o] || !['Gas', 'Interviews'].includes(req.sheet))) row[o] = user.name;
      if (req.sheet === 'Reports' && !row.status) row.status = 'Open';
      if (req.sheet === 'Submissions') {
        const f = (await table<FormReq>('Forms')).find(x => x.id === row.formId);
        if (!f) throw new Error('That form is not in the Forms list anymore.');
        Object.assign(row, { form: f.form, status: 'Submitted', reviewedBy: '', reviewedAt: '', fileLink: '' });
      }
      rows.push(row);
      await save(req.sheet, rows);
      return row;
    }
    case 'update': {
      const p = { ...req.patch };
      if (req.sheet === 'Reports' && p.status === 'Resolved') p.resolvedBy = user.name;
      return patch(req.sheet, 'id', req.id, p);
    }
    case 'remove': {
      const rows = (await table<Row>(req.sheet)).filter(r => r.id !== req.id);
      await save(req.sheet, rows);
      if (req.sheet === 'Media') await idb.del('blobs', 'media:' + req.id);
      return { removed: true };
    }
    case 'confirmStayover':
      return patch('Stayovers', 'id', req.id, {
        confirmed: !!req.confirmed, confirmedBy: req.confirmed ? user.name : '', confirmedAt: req.confirmed ? new Date().toISOString() : '',
        ...(req.callNotes !== undefined ? { callNotes: req.callNotes } : {}),
      });
    case 'updateStayover': return patch('Stayovers', 'id', req.id, req.patch);
    case 'claimCall': return patch('Stayovers', 'id', req.id, { caller: user.name });
    case 'swapDriver': {
      const it = await table<Day>('Itinerary');
      const d = it.find(x => x.day === Number(req.day));
      if (!d) throw new Error('That day is not in the itinerary.');
      const from = d.driver;
      const list = String(from || '').split(/[,&/]| and /i).map(s => s.trim()).filter(Boolean);
      d.driver = req.replace && list.length > 1
        ? list.map(s => (s.toLowerCase() === String(req.replace).toLowerCase() ? req.toDriver : s)).join(', ')
        : req.toDriver;
      await save('Itinerary', it);
      const swaps = await table<Row>('DriverSwaps');
      swaps.push({ id: req.id || newId(), timestamp: new Date().toISOString(), day: d.day, fromDriver: from, toDriver: d.driver, changedBy: user.name, reason: req.reason || '' });
      await save('DriverSwaps', swaps);
      return { day: d.day, driver: d.driver };
    }
    case 'setRoute': {
      if (!isLeader(user)) {
        const d = (await table<Day>('Itinerary')).find(x => x.day === Number(req.day));
        if (!d || !hasName(d.routeLeader, user.name)) throw new Error('Only the route master, leaders or the day\'s route leader can change the route.');
      }
      const p: Row = {};
      if (req.plannedMiles !== undefined && req.plannedMiles !== '') p.plannedMiles = Number(req.plannedMiles);
      if (req.rwgpsLink !== undefined) p.rwgpsLink = req.rwgpsLink;
      const day = await patch('Itinerary', 'day', Number(req.day), p);
      return { day, warning: req.rwgpsLink ? 'Demo mode cannot read miles from RideWithGPS. With the real backend, route miles and climbing fill in automatically.' : '' };
    }
    case 'reviewForm': {
      if (!isLeader(user)) throw new Error('Only leaders can review forms.');
      const rows = await table<Row>('Submissions');
      const now = new Date().toISOString();
      const hit = rows.find(r => r.id === req.id);
      if (hit) {
        Object.assign(hit, { status: req.status, note: req.note || '', reviewedBy: user.name, reviewedAt: now });
        await save('Submissions', rows);
        return hit;
      }
      const f = (await table<FormReq>('Forms')).find(x => x.id === req.formId);
      if (!f) throw new Error('Pick a rider and a form.');
      const row = { id: req.id || newId(), timestamp: now, day: 0, rider: req.rider, formId: f.id, form: f.form, status: req.status,
        note: req.note || '', fileLink: '', reviewedBy: user.name, reviewedAt: now };
      rows.push(row);
      await save('Submissions', rows);
      return row;
    }
    case 'toggleDuty':
      return patch('Duties', 'id', req.id, { done: !!req.done, doneBy: req.done ? user.name : '', doneAt: req.done ? new Date().toISOString() : '' });
    case 'addDuty': {
      const rows = await table<Duty>('Duties');
      rows.push({ ...req.row, done: false, doneBy: '', doneAt: '' });
      await save('Duties', rows);
      return req.row;
    }
    case 'demoUpload': {
      const m = req.meta as Row;
      const blob = await getBlob(req.blobKey);
      if (!blob) throw new Error('The file is no longer on this phone.');
      await putBlob('media:' + m.id, blob);
      const rows = await table<Row>('Media');
      const row = { id: m.id, timestamp: new Date().toISOString(), day: m.day, uploader: user.name, kind: m.kind, fileName: m.fileName,
        mimeType: m.mimeType, size: blob.size, driveFileId: '', driveUrl: '', caption: m.caption || '', linkedSheet: m.linkedSheet || '', linkedId: m.linkedId || '' };
      if (!rows.find(r => r.id === row.id)) rows.push(row);
      await save('Media', rows);
      return { done: true, media: row };
    }
    default:
      throw new Error('Demo mode does not support ' + action);
  }
}

/** Demo files live on the phone; give the gallery an address for them. */
const urlCache = new Map<string, string>();
export async function demoMediaUrl(id: string): Promise<string | undefined> {
  if (urlCache.has(id)) return urlCache.get(id);
  const b = await getBlob('media:' + id);
  if (!b) return undefined;
  const u = URL.createObjectURL(b);
  urlCache.set(id, u);
  return u;
}

export async function resetDemo() {
  for (const k of await idb.keys('local')) if (String(k).startsWith('demo:')) await idb.del('local', String(k));
  for (const k of await idb.keys('blobs')) if (String(k).startsWith('media:')) await idb.del('blobs', String(k));
  seeding = null;
}
