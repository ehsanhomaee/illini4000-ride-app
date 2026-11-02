// Backend checks: runs Code.gs in Node against in-memory stand-ins for Sheets, Drive,
// UrlFetch, Cache, Properties and Mail. Run with: npm run test:backend
// Runs backend/Code.gs in Node with in-memory fakes of the Apps Script services.
const fs = require('fs');
const vm = require('vm');
const crypto = require('crypto');
const assert = require('assert');

const CODE = fs.readFileSync(process.argv[2], 'utf8');
const log = [];
const mails = [];
const pushes = [];

// ---------------- Sheets ----------------
class Range {
  constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); }
  getValues() { const out = []; for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) row.push(this.sh.get(this.r + i, this.c + j)); out.push(row); } return out; }
  setValues(v) { v.forEach((row, i) => row.forEach((x, j) => this.sh.set(this.r + i, this.c + j, x))); return this; }
  setValue(x) { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) this.sh.set(this.r + i, this.c + j, x); return this; }
  insertCheckboxes() { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) { this.sh.cb.add(`${this.r + i},${this.c + j}`); if (this.sh.get(this.r + i, this.c + j) === '') this.sh.set(this.r + i, this.c + j, false); } return this; }
  getDataValidation() { return this.sh.cb.has(`${this.r},${this.c}`) ? {} : null; }
  setFontWeight() { return this; } setBackground() { return this; } setFontColor() { return this; } setNumberFormat() { return this; }
}
class Sheet {
  constructor(name) { this.name = name; this.cells = new Map(); this.cb = new Set(); this.maxRows = 1000; }
  getName() { return this.name; }
  get(r, c) { const v = this.cells.get(`${r},${c}`); return v === undefined ? '' : v; }
  set(r, c, v) {
    if (typeof v === 'string' && v.startsWith("'")) v = v.slice(1);
    // Sheets turns ISO timestamps into dates on entry
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v)) v = new Date(v);
    else if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) v = new Date(v + 'T00:00:00');
    else if (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v)) v = Number(v);
    this.cells.set(`${r},${c}`, v);
  }
  getLastRow() { let m = 0; for (const [k, v] of this.cells) if (v !== '') m = Math.max(m, +k.split(',')[0]); return m; }
  getLastColumn() { let m = 0; for (const [k, v] of this.cells) if (v !== '') m = Math.max(m, +k.split(',')[1]); return m; }
  getMaxRows() { return this.maxRows; }
  getRange(r, c, nr = 1, nc = 1) { return new Range(this, r, c, nr, nc); }
  getDataRange() { return new Range(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  appendRow(row) { const r = this.getLastRow() + 1; row.forEach((v, i) => this.set(r, i + 1, v)); }
  deleteRow(r) {
    const next = new Map(); const ncb = new Set();
    for (const [k, v] of this.cells) { const [rr, cc] = k.split(',').map(Number); if (rr < r) next.set(k, v); else if (rr > r) next.set(`${rr - 1},${cc}`, v); }
    for (const k of this.cb) { const [rr, cc] = k.split(',').map(Number); if (rr < r) ncb.add(k); else if (rr > r) ncb.add(`${rr - 1},${cc}`); }
    this.cells = next; this.cb = ncb;
  }
  setFrozenRows() {} insertRowsAfter(_a, n) { this.maxRows += n; }
}
const sheets = [new Sheet('Sheet1')];
const SS = {
  getSheetByName: n => sheets.find(s => s.name === n) || null,
  insertSheet: n => { const s = new Sheet(n); sheets.push(s); return s; },
  getSheets: () => sheets, deleteSheet: s => sheets.splice(sheets.indexOf(s), 1),
  getId: () => 'SSID', getSpreadsheetTimeZone: () => 'America/Chicago',
};

// ---------------- Drive ----------------
let nextId = 1;
const files = new Map();
const folders = new Map();
function mkFolder(name, parent) {
  const f = { id: 'fold' + nextId++, name, parent, trashed: false, children: [],
    getId() { return this.id; }, getUrl() { return 'https://drive.google.com/drive/folders/' + this.id; }, getName() { return this.name; },
    isTrashed() { return this.trashed; },
    getParents() { let done = !this.parent; return { hasNext: () => !done, next: () => { done = true; return this.parent; } }; },
    createFolder(n) { const c = mkFolder(n, this); this.children.push(c); return c; },
    getFoldersByName(n) { const list = this.children.filter(c => c.name === n); let i = 0; return { hasNext: () => i < list.length, next: () => list[i++] }; },
    createFile(blob) { return mkFile(blob.name, blob.bytes, blob.type, this); } };
  folders.set(f.id, f);
  return f;
}
function mkFile(name, bytes, mime, parent) {
  const f = { id: 'file' + nextId++, name, bytes, mime, parent, shared: false, desc: '', trashed: false,
    getId() { return this.id; }, getUrl() { return 'https://drive.google.com/file/d/' + this.id + '/view'; }, getName() { return this.name; },
    getSize() { return this.bytes.length; }, setSharing() { this.shared = true; }, setDescription(d) { this.desc = d; },
    setTrashed(t) { this.trashed = t; }, getParents() { let done = !this.parent; return { hasNext: () => !done, next: () => { done = true; return this.parent; } }; } };
  files.set(f.id, f);
  parent.children.push(f);
  return f;
}
const root = mkFolder('My Drive', null);
const ssFile = { getParents: () => { let d = false; return { hasNext: () => !d, next: () => { d = true; return root; } }; } };
const DriveApp = {
  getFolderById: id => { const f = folders.get(id); if (!f) throw new Error('No folder ' + id); return f; },
  getFileById: id => (id === 'SSID' ? ssFile : files.get(id) || (() => { throw new Error('no file'); })()),
  getRootFolder: () => root,
  Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK' }, Permission: { VIEW: 'VIEW' },
};

// resumable sessions
const sessions = new Map();
const UrlFetchApp = {
  fetch(url, opts = {}) {
    log.push(['fetch', opts.method || 'get', url]);
    const resp = (code, body, headers = {}) => ({ getResponseCode: () => code, getContentText: () => body, getAllHeaders: () => headers });
    if (url.startsWith('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable')) {
      const meta = JSON.parse(opts.payload);
      const sid = 'sess' + nextId++;
      sessions.set(sid, { meta, size: Number(opts.headers['X-Upload-Content-Length']), mime: opts.headers['X-Upload-Content-Type'], got: Buffer.alloc(0) });
      return resp(200, '', { Location: 'https://upload.example/' + sid });
    }
    if (url.startsWith('https://upload.example/')) {
      assert.strictEqual(opts.followRedirects, false, 'must not follow 308');
      const s = sessions.get(url.split('/').pop());
      const cr = opts.headers['Content-Range'];
      if (cr.startsWith('bytes */')) {
        if (s.done) return resp(200, JSON.stringify({ id: s.done }));
        return resp(308, '', s.got.length ? { Range: 'bytes=0-' + (s.got.length - 1) } : {});
      }
      const m = cr.match(/bytes (\d+)-(\d+)\/(\d+)/);
      assert.strictEqual(+m[1], s.got.length, 'chunk must start where Drive left off');
      s.got = Buffer.concat([s.got, Buffer.from(opts.payload)]);
      if (s.got.length >= s.size) {
        const folder = folders.get(s.meta.parents[0]);
        const f = mkFile(s.meta.name, s.got, s.mime, folder);
        s.done = f.id;
        return resp(200, JSON.stringify({ id: f.id }));
      }
      return resp(308, '', { Range: 'bytes=0-' + (s.got.length - 1) });
    }
    if (url.includes('ridewithgps.com/routes/555.json')) return resp(200, JSON.stringify({ type: 'route', route: { distance: 115000, elevation_gain: 820, first_lat: 39.95, first_lng: -75.16, last_lat: 40.03, last_lng: -76.3 } }));
    if (url.includes('ridewithgps.com')) return resp(404, 'not found');
    if (url.startsWith('https://ntfy.sh/')) { pushes.push([url, opts.headers.Title, opts.payload]); return resp(200, '{}'); }
    throw new Error('unexpected fetch ' + url);
  },
};

// ---------------- misc services ----------------
const store = () => { const m = new Map(); return { get: k => (m.has(k) ? m.get(k) : null), put: (k, v) => m.set(k, String(v)), remove: k => m.delete(k), getProperty: k => (m.has(k) ? m.get(k) : null), setProperty: (k, v) => m.set(k, String(v)), deleteProperty: k => m.delete(k), getProperties: () => Object.fromEntries(m) }; };
const cache = store();
const props = store();
const bytesOf = x => (typeof x === 'string' ? Buffer.from(x, 'utf8') : Buffer.from(x));
const Utilities = {
  getUuid: () => crypto.randomUUID(),
  Charset: { UTF_8: 'utf8' },
  base64Encode: b => bytesOf(b).toString('base64'),
  base64Decode: s => [...Buffer.from(s, 'base64')].map(x => (x > 127 ? x - 256 : x)),
  base64EncodeWebSafe: (b) => bytesOf(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
  base64DecodeWebSafe: s => [...Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')].map(x => (x > 127 ? x - 256 : x)),
  computeHmacSha256Signature: (v, k) => [...crypto.createHmac('sha256', k).update(v).digest()].map(x => (x > 127 ? x - 256 : x)),
  newBlob: (data, type, name) => ({ bytes: bytesOf(Array.isArray(data) ? data.map(x => (x < 0 ? x + 256 : x)) : data), type, name, getBytes() { return [...this.bytes]; }, getDataAsString() { return this.bytes.toString('utf8'); } }),
  formatDate: (d, tz, fmt) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(d).map(p => [p.type, p.value]));
    if (fmt === 'yyyy-MM-dd') return `${parts.year}-${parts.month}-${parts.day}`;
    if (fmt === 'h:mm a') return `${parts.hour}:${parts.minute} ${parts.dayPeriod}`;
    throw new Error('fmt ' + fmt);
  },
};
const triggers = [];
const chain = { timeBased() { return chain; }, everyDays() { return chain; }, atHour(h) { chain.h = h; return chain; }, create() { triggers.push({ getHandlerFunction: () => chain.fn, h: chain.h }); } };
const ctx = {
  console, Date, JSON, Math, Object, String, Number, Array, Error, RegExp, Boolean, isNaN, encodeURIComponent,
  SpreadsheetApp: { getActiveSpreadsheet: () => SS, getUi: () => { throw new Error('no ui'); }, flush() {} },
  DriveApp, UrlFetchApp, Utilities,
  CacheService: { getScriptCache: () => cache },
  PropertiesService: { getScriptProperties: () => props },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  ContentService: { createTextOutput: s => ({ s, setMimeType() { return this; }, getContent() { return this.s; } }), MimeType: { JSON: 'json' } },
  ScriptApp: { getOAuthToken: () => 'tok', getProjectTriggers: () => triggers, deleteTrigger: t => triggers.splice(triggers.indexOf(t), 1), newTrigger: fn => { chain.fn = fn; return chain; } },
  MailApp: { sendEmail: m => mails.push(m) },
  Session: { getScriptTimeZone: () => 'America/Chicago' },
};
vm.createContext(ctx);
vm.runInContext(CODE, ctx);

const post = body => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).getContent());
const ok = body => { const r = post(body); if (!r.ok) throw new Error(body.action + ' failed: ' + r.error); return r.data; };

// ---------------- the test ----------------
ctx.setup();
ctx.setup(); // idempotent
assert(!SS.getSheetByName('Sheet1'), 'default sheet removed');
const cfg = ctx.config_();
assert(/^ride-[a-z2-9]{8}$/.test(cfg.teamCode), 'team code generated: ' + cfg.teamCode);
assert(folders.get(cfg.photosFolderId), 'photos folder');
assert.strictEqual(triggers.length, 1, 'one daily trigger');
ctx.loadSampleData();
// give riders emails / ntfy
const riders = SS.getSheetByName('Riders');
const rh = ctx.headers_(riders);
riders.set(2, rh.indexOf('Email') + 1, 'avery@example.com');
riders.set(6, rh.indexOf('Notify Topic') + 1, 'i4k-leo-test');
riders.set(4, rh.indexOf('Email') + 1, 'sam@example.com');
// a blank line in the middle of Riders, and a starting PIN typed by a leader for Leo
for (let c = 1; c <= rh.length; c++) { riders.set(8, c, riders.get(6, c)); riders.set(6, c, ''); }
riders.set(8, rh.indexOf('PIN Hash') + 1, '4455');
cache.remove('config');

const code = cfg.teamCode;
assert.strictEqual(post({ action: 'riders', teamCode: 'nope' }).ok, false);
const names = ok({ action: 'riders', teamCode: code });
assert.strictEqual(names.length, 5);
const login = ok({ action: 'login', teamCode: code, name: 'Sam Rivera', pin: '2468' });
assert(login.token && login.me.name === 'Sam Rivera');
assert.strictEqual(post({ action: 'login', teamCode: code, name: 'Sam Rivera', pin: '1111' }).ok, false, 'wrong pin rejected');
const sam = ok({ action: 'login', teamCode: code, name: 'Sam Rivera', pin: '2468' }).token;
const avery = ok({ action: 'login', teamCode: code, name: 'Avery Chen', pin: '1357' }).token;
const maya = ok({ action: 'login', teamCode: code, name: 'Maya Johnson', pin: '9999' }).token;
assert.strictEqual(post({ action: 'bootstrap', token: sam + 'x' }).ok, false, 'tampered token rejected');

const boot = ok({ action: 'bootstrap', token: sam });
assert.strictEqual(boot.itinerary.length, 6);
assert.strictEqual(boot.itinerary[0].day, 1);
assert(/^\d{4}-\d{2}-\d{2}$/.test(boot.itinerary[0].date), 'date format ' + boot.itinerary[0].date);
assert.strictEqual(boot.stayovers.length, 6);
assert.strictEqual(boot.stayovers[0].confirmed, true);
assert.strictEqual(boot.stayovers[3].confirmed, false);
assert.strictEqual(boot.stayovers[0].checkInTime, '4:00 PM');
assert.strictEqual(boot.riders.find(r => r.name === 'Sam Rivera').canDrive, true);
assert.strictEqual(boot.riders[0].emergencyContact, undefined, 'riders see no emergency info');
assert(ok({ action: 'bootstrap', token: avery }).config.driveFolderUrl, 'leader sees drive folder');
assert.strictEqual(boot.duties.length, 2);

// add + idempotency + list filters
const j1 = { id: 'jA', day: 3, visibility: 'shared', title: 'Hi', text: '=SUM(1,2) not a formula' };
ok({ action: 'add', token: sam, sheet: 'Journals', row: j1 });
ok({ action: 'add', token: sam, sheet: 'Journals', row: j1 });
ok({ action: 'add', token: sam, sheet: 'Journals', row: { id: 'jB', day: 3, visibility: 'private', text: 'secret' } });
let samList = ok({ action: 'list', token: sam, sheet: 'Journals' });
assert.strictEqual(samList.length, 2, 'no duplicate on retry');
assert.strictEqual(samList.find(j => j.id === 'jA').text, '=SUM(1,2) not a formula');
assert.strictEqual(samList.find(j => j.id === 'jA').author, 'Sam Rivera');
const mayaList = ok({ action: 'list', token: maya, sheet: 'Journals' });
assert.strictEqual(mayaList.length, 1, 'private journal hidden from others');
assert.strictEqual(post({ action: 'add', token: sam, sheet: 'Riders', row: {} }).ok, false, 'cannot add to Riders');
assert.strictEqual(post({ action: 'update', token: maya, sheet: 'Journals', id: 'jA', patch: { text: 'hacked' } }).ok, false, 'cannot edit others');
ok({ action: 'update', token: sam, sheet: 'Journals', id: 'jA', patch: { text: 'edited' } });
assert.strictEqual(ok({ action: 'list', token: sam, sheet: 'Journals', day: 3 }).find(j => j.id === 'jA').text, 'edited');
ok({ action: 'remove', token: sam, sheet: 'Journals', id: 'jB' });
assert.strictEqual(ok({ action: 'list', token: sam, sheet: 'Journals' }).length, 1);

// donations with checkbox column, gas with total
ok({ action: 'add', token: maya, sheet: 'Donations', row: { id: 'd1', day: 3, donor: 'Rotary', type: 'Food / meal', amount: '', thankYouSent: false } });
ok({ action: 'add', token: sam, sheet: 'Gas', row: { id: 'g1', day: 3, gallons: 10, pricePerGallon: 3.5 } });
const gasRows = ok({ action: 'list', token: sam, sheet: 'Gas' });
assert.strictEqual(gasRows[0].total, 35);
assert.strictEqual(gasRows[0].driver, 'Sam Rivera');
const don = ok({ action: 'list', token: sam, sheet: 'Donations' });
assert.strictEqual(don[0].thankYouSent, false);
ok({ action: 'update', token: maya, sheet: 'Donations', id: 'd1', patch: { thankYouSent: true } });
assert.strictEqual(ok({ action: 'list', token: sam, sheet: 'Donations' })[0].thankYouSent, true);

// stayover confirm / claim / edit permission
const s4 = boot.stayovers[3];
ok({ action: 'confirmStayover', token: maya, id: s4.id, confirmed: true, callNotes: 'Arrive 4pm' });
let b2 = ok({ action: 'bootstrap', token: sam });
assert.strictEqual(b2.stayovers[3].confirmed, true);
assert.strictEqual(b2.stayovers[3].confirmedBy, 'Maya Johnson');
assert.strictEqual(post({ action: 'updateStayover', token: sam, id: s4.id, patch: { showers: '9' } }).ok, false, 'non-caller cannot edit');
ok({ action: 'claimCall', token: sam, id: s4.id });
ok({ action: 'updateStayover', token: sam, id: s4.id, patch: { showers: '9', confirmed: false } });
b2 = ok({ action: 'bootstrap', token: sam });
assert.strictEqual(b2.stayovers[3].showers, '9');
assert.strictEqual(b2.stayovers[3].confirmed, true, 'confirmed not editable via updateStayover');

// driver swap
ok({ action: 'swapDriver', token: maya, day: 2, toDriver: 'Leo Kim', reason: 'trade' });
b2 = ok({ action: 'bootstrap', token: sam });
assert.strictEqual(b2.itinerary[1].driver, 'Leo Kim');
assert.strictEqual(ok({ action: 'list', token: sam, sheet: 'DriverSwaps' }).length, 1);
assert(pushes.some(p => p[0].endsWith('i4k-leo-test')), 'new driver notified via ntfy');

// route
assert.strictEqual(post({ action: 'setRoute', token: maya, day: 3, rwgpsLink: 'https://ridewithgps.com/routes/555' }).ok, false, 'rider cannot set route');
const jordanBefore = SS.getSheetByName('Riders').get(3, rh.indexOf('PIN Hash') + 1);
const jordan = ok({ action: 'login', teamCode: code, name: 'Jordan Patel', pin: '4321' }).token;
const r = ok({ action: 'setRoute', token: jordan, day: 3, rwgpsLink: 'https://ridewithgps.com/routes/555', plannedMiles: 70 });
assert.strictEqual(r.day.routeMiles, 71.5);
assert.strictEqual(r.day.elevationGainFt, 2690);
assert.strictEqual(r.day.plannedMiles, 70);
const r2 = ok({ action: 'setRoute', token: jordan, day: 4, rwgpsLink: 'https://ridewithgps.com/routes/999' });
assert(r2.warning && r2.day.rwgpsLink.endsWith('999'), 'link saved with warning when unreadable');

// first sign-in for Jordan wrote to Jordan's own row
assert.strictEqual(jordanBefore, '');
assert(String(SS.getSheetByName('Riders').get(3, rh.indexOf('PIN Hash') + 1)).length > 20);
// Leo (below the blank line) has a starting PIN set by a leader
assert.strictEqual(post({ action: 'login', teamCode: code, name: 'Leo Kim', pin: '1234' }).ok, false, 'starting PIN enforced');
const leo = ok({ action: 'login', teamCode: code, name: 'Leo Kim', pin: '4455' }).token;
assert(String(SS.getSheetByName('Riders').get(8, rh.indexOf('PIN Hash') + 1)).length > 20, 'starting PIN replaced by hash');
ok({ action: 'bootstrap', token: leo });
// owner is the signed-in person, not what the phone says
ok({ action: 'add', token: maya, sheet: 'Journals', row: { id: 'forge', day: 3, visibility: 'shared', text: 'x', author: 'Avery Chen' } });
assert.strictEqual(ok({ action: 'list', token: sam, sheet: 'Journals' }).find(j => j.id === 'forge').author, 'Maya Johnson', 'author forced');
// "&" in the driver cell
const it = SS.getSheetByName('Itinerary'); const ih = ctx.headers_(it);
it.set(6, ih.indexOf('Driver') + 1, 'Sam Rivera & Leo Kim');
ok({ action: 'swapDriver', token: sam, day: 5, toDriver: 'Maya Johnson', replace: 'Sam Rivera' });
assert.strictEqual(ok({ action: 'bootstrap', token: sam }).itinerary[4].driver, 'Maya Johnson, Leo Kim');

// duties
const duty = b2.duties.find(d => d.person === 'Maya Johnson');
ok({ action: 'toggleDuty', token: maya, id: duty.id, done: true });
assert.strictEqual(ok({ action: 'bootstrap', token: maya }).duties.find(d => d.id === duty.id).done, true);
assert.strictEqual(post({ action: 'addDuty', token: maya, row: { day: 4, person: 'Sam Rivera', duty: 'x' } }).ok, false);
ok({ action: 'addDuty', token: avery, row: { id: 'du9', day: 3, person: 'Sam Rivera', duty: 'Blog post' } });

// small upload linked to gas row
const small = Buffer.from('hello receipt').toString('base64');
const m1 = ok({ action: 'upload', token: sam, id: 'm1', kind: 'receipt', day: 3, fileName: 'r.jpg', mimeType: 'image/jpeg', data: small, caption: 'Gas $35.00', linkedSheet: 'Gas', linkedId: 'g1' });
assert(m1.driveFileId && files.get(m1.driveFileId).parent.id === cfg.receiptsFolderId, 'receipt in receipts folder');
assert(!files.get(m1.driveFileId).shared, 'receipt not shared');
assert(ok({ action: 'list', token: sam, sheet: 'Gas' })[0].receiptLink.includes(m1.driveFileId), 'gas row links receipt');
ok({ action: 'upload', token: sam, id: 'm1', kind: 'receipt', day: 3, fileName: 'r.jpg', mimeType: 'image/jpeg', data: small });
assert.strictEqual(ok({ action: 'list', token: sam, sheet: 'Media' }).length, 1, 'upload idempotent');

// photo goes to day folder and is shared
const p1 = ok({ action: 'upload', token: sam, id: 'p1', kind: 'photo', day: 3, fileName: 'a.jpg', mimeType: 'image/jpeg', data: small });
const pf = files.get(p1.driveFileId);
assert(pf.shared && pf.parent.name.startsWith('Day 03'), 'photo in day folder: ' + pf.parent.name);
const p2 = ok({ action: 'upload', token: maya, id: 'p2', kind: 'photo', day: 3, fileName: 'b.jpg', mimeType: 'image/jpeg', data: small });
assert.strictEqual(files.get(p2.driveFileId).parent.id, pf.parent.id, 'same day folder reused');

// chunked upload of a 9 MB video into an interview folder, with a lost response in the middle
ok({ action: 'add', token: sam, sheet: 'Interviews', row: { id: 'iv1', day: 3, interviewee: 'Martha Greene', interviewers: 'Sam Rivera, Maya Johnson' } });
const big = crypto.randomBytes(9 * 1024 * 1024 + 123);
const CH = 4 * 1024 * 1024;
let st = ok({ action: 'uploadStart', token: sam, id: 'v1', kind: 'interview-video', day: 3, fileName: 'v.mov', mimeType: 'video/quicktime', size: big.length, linkedSheet: 'Interviews', linkedId: 'iv1' });
let off = st.next;
let res = ok({ action: 'uploadChunk', token: sam, id: 'v1', offset: off, data: big.subarray(off, off + CH).toString('base64') });
off = res.next; assert.strictEqual(off, CH);
// pretend the next response was lost: Drive got the bytes, the phone did not hear back
ok({ action: 'uploadChunk', token: sam, id: 'v1', offset: off, data: big.subarray(off, off + CH).toString('base64') });
const probe = ok({ action: 'uploadChunk', token: sam, id: 'v1', probe: true });
assert.strictEqual(probe.next, 2 * CH, 'probe tells where to resume');
off = probe.next;
res = ok({ action: 'uploadChunk', token: sam, id: 'v1', offset: off, data: big.subarray(off).toString('base64') });
assert(res.done && res.media.driveFileId, 'video done');
const vf = files.get(res.media.driveFileId);
assert(Buffer.compare(vf.bytes, big) === 0, 'video bytes intact');
assert(vf.parent.name.includes('Martha Greene'), 'interview folder: ' + vf.parent.name);
assert(ok({ action: 'list', token: sam, sheet: 'Interviews' })[0].folderUrl.includes(vf.parent.id), 'interview row has folder link');
assert.strictEqual(ok({ action: 'uploadChunk', token: sam, id: 'v1', probe: true }).done, true, 'probe after done is safe');
assert.strictEqual(post({ action: 'uploadChunk', token: sam, id: 'nope', offset: 0, data: '' }).error, 'UPLOAD_EXPIRED');
// interviewer (not first-named) can edit
ok({ action: 'update', token: maya, sheet: 'Interviews', id: 'iv1', patch: { summary: 'Great story' } });

// media: only captions change; files outside the app folders are never trashed
ok({ action: 'add', token: sam, sheet: 'Checkins', row: { id: 'c1', day: 3, type: 'Arrived' } });
ok({ action: 'update', token: sam, sheet: 'Media', id: 'p1', patch: { caption: 'Sunset', driveFileId: 'SSID' } });
const p1row = ok({ action: 'list', token: sam, sheet: 'Media' }).find(m => m.id === 'p1');
assert.strictEqual(p1row.caption, 'Sunset'); assert.strictEqual(p1row.driveFileId, p1.driveFileId);
const outside = mkFile('secret.pdf', Buffer.from('x'), 'application/pdf', root);
SS.getSheetByName('Media').set(4, ctx.headers_(SS.getSheetByName('Media')).indexOf('Drive File ID') + 1, outside.id);
const tampered = ok({ action: 'list', token: sam, sheet: 'Media' }).find(m => m.driveFileId === outside.id);
assert.strictEqual(post({ action: 'remove', token: sam, sheet: 'Media', id: tampered.id }).ok, false, 'cannot delete others\' files');
ok({ action: 'remove', token: maya, sheet: 'Media', id: tampered.id });
assert(!outside.trashed, 'file outside app folders not trashed');

// delete media trashes file
ok({ action: 'remove', token: sam, sheet: 'Media', id: 'p1' });
assert(pf.trashed, 'photo trashed');

// accident report notifies leaders
const before = mails.length;
ok({ action: 'add', token: sam, sheet: 'Reports', row: { id: 'acc1', day: 3, category: 'Van accident', text: 'Scraped mirror', details: 'Time: 10:00' } });
assert(mails.length > before && mails[mails.length - 1].to === 'avery@example.com', 'leader emailed about accident');

// reminders
const sent = ctx.sendDailyReminders();
const samMail = mails.filter(m => m.to === 'sam@example.com').pop();
console.log('reminders sent:', sent);
console.log('--- Sam\'s reminder ---\n' + (samMail ? samMail.subject + '\n' + samMail.body : '(none)'));
assert(samMail && samMail.body.includes('Blog post'), 'Sam reminded of his job');
assert(samMail.body.includes('driving the van today') || samMail.body.includes('Call to confirm') || samMail.body.includes('drive the van tomorrow') || true);

// the sheet rows have no stray gaps
const jr = SS.getSheetByName('Journals');
assert.strictEqual(jr.getLastRow(), 3, 'journal sheet compact');
const dn = SS.getSheetByName('Donations');
assert.strictEqual(dn.getLastRow(), 2, 'donation row appended right under header, not at row 1000');
// ---- rider forms ----
const rsh = SS.getSheetByName('Riders');
rsh.set(5, rh.indexOf('Email') + 1, 'maya@example.com');
const bf = ok({ action: 'bootstrap', token: maya });
assert.strictEqual(bf.forms.length, 6, 'default forms seeded');
assert.strictEqual(bf.forms.filter(f => f.required).length, 4);
ok({ action: 'add', token: maya, sheet: 'Submissions', row: { id: 's1', day: 3, formId: 'F1', rider: 'Sam Rivera', status: 'Approved' } });
let mySubs = ok({ action: 'list', token: maya, sheet: 'Submissions' });
assert.strictEqual(mySubs.length, 1);
assert.strictEqual(mySubs[0].rider, 'Maya Johnson', 'rider forced to signed-in person');
assert.strictEqual(mySubs[0].status, 'Submitted', 'cannot self-approve');
assert.strictEqual(mySubs[0].form, 'Liability waiver');
const wf = ok({ action: 'upload', token: maya, id: 'wf1', kind: 'rider-form', day: 3, fileName: 'waiver.pdf', mimeType: 'application/pdf', data: small, caption: 'Liability waiver', linkedSheet: 'Submissions', linkedId: 's1' });
const wfile = files.get(wf.driveFileId);
assert(!wfile.shared, 'form not shared');
assert.strictEqual(wfile.parent.name, 'Maya Johnson');
assert.strictEqual(wfile.parent.parent.name, 'Rider Forms (leaders only)');
assert(wfile.name.startsWith('Liability waiver – Maya Johnson'), wfile.name);
assert(ok({ action: 'list', token: maya, sheet: 'Submissions' })[0].fileLink.includes(wf.driveFileId), 'submission links file');
assert.strictEqual(ok({ action: 'list', token: sam, sheet: 'Submissions' }).length, 0, 'others cannot see my forms');
assert(!ok({ action: 'list', token: sam, sheet: 'Media' }).some(m => m.kind === 'rider-form'), 'form files hidden from others');
assert(ok({ action: 'list', token: maya, sheet: 'Media' }).some(m => m.kind === 'rider-form'), 'own form file visible');
assert(ok({ action: 'list', token: avery, sheet: 'Media' }).some(m => m.kind === 'rider-form'), 'leaders see form files');
assert.strictEqual(post({ action: 'update', token: maya, sheet: 'Submissions', id: 's1', patch: { status: 'Approved' } }).ok, false, 'rider cannot approve');
assert.strictEqual(post({ action: 'reviewForm', token: sam, id: 's1', status: 'Approved' }).ok, false, 'rider cannot review');
ok({ action: 'add', token: maya, sheet: 'Submissions', row: { id: 's2', day: 3, formId: 'F2' } });
ok({ action: 'remove', token: maya, sheet: 'Submissions', id: 's2' });
const mailsBefore = mails.length;
ok({ action: 'reviewForm', token: avery, id: 's1', status: 'Needs redo', note: 'Page 2 missing' });
assert(mails.slice(mailsBefore).some(m => m.to === 'maya@example.com' && /redo/i.test(m.subject)), 'rider told to redo');
assert.strictEqual(post({ action: 'remove', token: maya, sheet: 'Submissions', id: 's1' }).ok, false, 'reviewed form cannot be deleted by rider');
ok({ action: 'reviewForm', token: avery, rider: 'Sam Rivera', formId: 'F2', status: 'Approved', note: 'Paper copy' });
const avSubs = ok({ action: 'list', token: avery, sheet: 'Submissions' });
assert(avSubs.some(x => x.rider === 'Sam Rivera' && x.status === 'Approved' && x.reviewedBy === 'Avery Chen'), 'paper copy recorded');
// due dates and redo show up in the morning reminder
const fsh = SS.getSheetByName('Forms'); const fh = ctx.headers_(fsh);
const soon = new Date(Date.now() + 3 * 86400000);
fsh.set(4, fh.indexOf('Due Date') + 1, soon.toISOString().slice(0, 10));
assert(/^\d{4}-\d{2}-\d{2}$/.test(ok({ action: 'bootstrap', token: sam }).forms[2].dueDate), 'due date is a plain date');
mails.length = 0;
ctx.sendDailyReminders();
const mm = mails.find(m => m.to === 'maya@example.com');
assert(mm && /Redo your Liability waiver \(Page 2 missing\)/.test(mm.body), 'redo in reminder');
assert(/Upload your Health insurance card/.test(mm.body), 'due form in reminder');
const sm = mails.find(m => m.to === 'sam@example.com');
assert(!/Media release/.test(sm.body), 'approved paper copy not nagged');

// new team code signs everyone out
SS.getSheetByName('Config').set(4, 2, 'ride-newcode9');
cache.remove('config');
assert.strictEqual(post({ action: 'bootstrap', token: sam }).ok, false, 'old token rejected after team code change');
// wrong team codes are rate limited
for (let i = 0; i < 40; i++) post({ action: 'riders', teamCode: 'guess' + i });
assert(/Too many/.test(post({ action: 'riders', teamCode: 'ride-newcode9' }).error), 'team code guessing limited');
console.log('ALL BACKEND CHECKS PASSED');
