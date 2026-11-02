/**
 * Illini 4000 Ride App: backend
 * ------------------------------------------------------------------
 * Paste this whole file into Extensions → Apps Script of the team's
 * "master" Google Sheet, run setup() once, then Deploy → New deployment →
 * Web app (Execute as: Me, Who has access: Anyone). Full walkthrough in
 * docs/SETUP.md.
 *
 * The Google Sheet is the master file: every tab is a table the app reads
 * and writes. Leaders and the route master can edit the Itinerary,
 * Stayovers, Riders and Duties tabs directly in the sheet.
 * Photos, videos, receipts, donations, interview recordings and report
 * photos are saved into separate Google Drive folders.
 */

// ---------------------------------------------------------------- schema --

var SCHEMA = {
  Config: ['Key', 'Value', 'Notes'],
  Riders: ['Name', 'Role', 'Phone', 'Email', 'Can Drive', 'Notify Topic', 'Emergency Contact', 'PIN Hash'],
  Itinerary: ['Day', 'Date', 'From', 'To', 'Planned Miles', 'RWGPS Link', 'Route Miles', 'Elevation Gain (ft)',
    'Start Lat', 'Start Lon', 'End Lat', 'End Lon', 'Stayover ID', 'Driver', 'Route Leader', 'Rest Day',
    'Route Notes', 'Notes From Previous Riders'],
  Stayovers: ['ID', 'Name', 'Address', 'City', 'Lat', 'Lon', 'Contact Name', 'Contact Phone', 'Contact Email',
    'Check-in Time', 'Check-out Time', 'Dinner', 'Breakfast', 'Lunch', 'Showers', 'Laundry', 'Sleeping', 'WiFi',
    'Van Parking', 'Notes', 'Caller', 'Confirmed', 'Confirmed By', 'Confirmed At', 'Call Notes'],
  Duties: ['ID', 'Day', 'Person', 'Duty', 'Details', 'Done', 'Done By', 'Done At'],
  DriverSwaps: ['ID', 'Timestamp', 'Day', 'From Driver', 'To Driver', 'Changed By', 'Reason'],
  Checkins: ['ID', 'Timestamp', 'Day', 'Rider', 'Type', 'Lat', 'Lon', 'Note'],
  Journals: ['ID', 'Timestamp', 'Day', 'Author', 'Visibility', 'Title', 'Text'],
  Reports: ['ID', 'Timestamp', 'Day', 'Author', 'Category', 'Severity', 'Text', 'Lat', 'Lon', 'Details', 'Status', 'Resolved By'],
  Gas: ['ID', 'Timestamp', 'Day', 'Driver', 'Gallons', 'Price Per Gallon', 'Total', 'Odometer', 'Station', 'Paid With', 'Notes', 'Receipt Link'],
  Expenses: ['ID', 'Timestamp', 'Day', 'Recorded By', 'Amount', 'Vendor', 'Category', 'Paid With', 'Reimburse To', 'Notes', 'Receipt Link'],
  Donations: ['ID', 'Timestamp', 'Day', 'Recorded By', 'Donor', 'Donor Contact', 'Type', 'Amount', 'Description', 'Thank You Sent', 'Notes', 'File Link'],
  Interviews: ['ID', 'Timestamp', 'Day', 'Interviewers', 'Interviewee', 'Location', 'Contact', 'Release Signed', 'Summary', 'Status', 'Folder URL'],
  Media: ['ID', 'Timestamp', 'Day', 'Uploader', 'Kind', 'File Name', 'Mime Type', 'Size', 'Drive File ID', 'Drive URL', 'Caption', 'Linked Sheet', 'Linked ID']
};

var CHECKBOX_COLUMNS = {
  Riders: ['Can Drive'], Itinerary: ['Rest Day'], Stayovers: ['Confirmed'], Duties: ['Done'],
  Donations: ['Thank You Sent'], Interviews: ['Release Signed']
};

// Who the person-column is for each tab people add to (used for "can edit own row").
var OWNER_COLUMN = {
  Checkins: 'rider', Journals: 'author', Reports: 'author', Gas: 'driver', Expenses: 'recordedBy',
  Donations: 'recordedBy', Interviews: 'interviewers', Media: 'uploader'
};
var CHOOSABLE_OWNER = ['Gas', 'Interviews']; // the form picks the driver / interviewers
var ADDABLE = ['Checkins', 'Journals', 'Reports', 'Gas', 'Expenses', 'Donations', 'Interviews'];
var LISTABLE = ADDABLE.concat(['Media', 'DriverSwaps']);

var CONFIG_DEFAULTS = [
  ['Team Name', 'Illini 4000', 'Shown at the top of the app'],
  ['Trip Year', String(new Date().getFullYear() + 1), ''],
  ['Team Code', '', 'Riders type this once when they sign in. Changing it signs every phone out.'],
  ['Confirm Days Ahead', '5', 'Stayovers are reconfirmed by phone this many days before arrival'],
  ['Reminder Hour', '6', 'Hour of day (0-23, script time zone) when the daily "your jobs today" reminder goes out. Re-run setup() after changing.'],
  ['Send Reminder Emails', 'TRUE', 'TRUE/FALSE. Emails go to the address in the Riders tab'],
  ['Share Photos With Link', 'TRUE', 'TRUE lets the app show photo thumbnails. Receipts, donations and interviews are never shared.'],
  ['App URL', '', 'Link to the installed app (GitHub Pages). Used in reminder emails'],
  ['Emergency Info', 'Emergency: call 911 first, then the trip leaders.', 'Shown on the Team screen'],
  ['RWGPS API Key', '', 'Optional. Only needed if routes are private on RideWithGPS'],
  ['RWGPS Auth Token', '', 'Optional, goes with the API key'],
  ['Root Folder ID', '', 'Filled by setup(). Main Drive folder'],
  ['Photos Folder ID', '', 'Filled by setup(). Paste another folder ID to save somewhere else'],
  ['Receipts Folder ID', '', 'Filled by setup()'],
  ['Donations Folder ID', '', 'Filled by setup()'],
  ['Interviews Folder ID', '', 'Filled by setup()'],
  ['Reports Folder ID', '', 'Filled by setup()']
];

// ------------------------------------------------------------- web entry --

function doGet() {
  return json_({ ok: true, app: 'Illini 4000 Ride App API', time: new Date().toISOString() });
}

function doPost(e) {
  var req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'The request was not valid JSON.' });
  }
  try {
    return json_({ ok: true, data: route_(req) });
  } catch (err) {
    var msg = err && err.message ? err.message : String(err);
    if (msg.indexOf('AUTH:') !== 0 && msg.indexOf('UPLOAD_EXPIRED') !== 0) console.error(req.action + ': ' + msg + '\n' + (err && err.stack));
    return json_({ ok: false, error: msg });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function route_(req) {
  var a = req.action;
  if (a === 'ping') return { pong: true };
  if (a === 'riders') { checkTeamCode_(req.teamCode); return readTable_('Riders').map(function (r) { return { name: r.name, role: normRole_(r.role) }; }).filter(function (r) { return r.name; }); }
  if (a === 'login') return login_(req);

  var me = verify_(req.token);
  switch (a) {
    case 'bootstrap': return bootstrap_(me);
    case 'list': return list_(me, req.sheet, req.day);
    case 'add': return withLock_(function () { return add_(me, req.sheet, req.row); });
    case 'update': return withLock_(function () { return update_(me, req.sheet, req.id, req.patch); });
    case 'remove': return withLock_(function () { return remove_(me, req.sheet, req.id); });
    case 'confirmStayover': return withLock_(function () { return confirmStayover_(me, req); });
    case 'updateStayover': return withLock_(function () { return updateStayover_(me, req.id, req.patch); });
    case 'claimCall': return withLock_(function () { return patchRow_('Stayovers', req.id, { caller: me.name }); });
    case 'swapDriver': return withLock_(function () { return swapDriver_(me, req); });
    case 'setRoute': return setRoute_(me, req);
    case 'toggleDuty': return withLock_(function () { return toggleDuty_(me, req.id, req.done); });
    case 'addDuty': return withLock_(function () { return addDuty_(me, req.row); });
    case 'upload': return upload_(me, req);
    case 'uploadStart': return uploadStart_(me, req);
    case 'uploadChunk': return uploadChunk_(me, req);
    default: throw new Error('Unknown action: ' + a);
  }
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try { return fn(); } finally { SpreadsheetApp.flush(); lock.releaseLock(); }
}

// ------------------------------------------------------------------ auth --

function props_() { return PropertiesService.getScriptProperties(); }

function secret_() {
  var s = props_().getProperty('TOKEN_SECRET');
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); props_().setProperty('TOKEN_SECRET', s); }
  return s;
}

function hmac_(text) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(text, secret_())).replace(/=+$/, '');
}

function pinHash_(name, pin) {
  return hmac_('pin|' + name.trim().toLowerCase() + '|' + String(pin).trim());
}

function teamCode_() { return String(config_().teamCode || '').trim().toLowerCase(); }

function checkTeamCode_(code) {
  var expected = teamCode_();
  if (!expected) throw new Error('AUTH: The team code has not been set yet. A leader needs to run setup() in the sheet.');
  var cache = CacheService.getScriptCache();
  var fails = Number(cache.get('teamcode_fails') || 0);
  if (fails >= 40) throw new Error('AUTH: Too many wrong team codes were tried. Wait 10 minutes and try again.');
  if (String(code || '').trim().toLowerCase() !== expected) {
    cache.put('teamcode_fails', String(fails + 1), 600);
    throw new Error('AUTH: That team code is not right. Ask a trip leader for it.');
  }
}

function newTeamCode_() {
  var abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  var out = '';
  for (var i = 0; i < 8; i++) out += abc.charAt(Math.floor(Math.random() * abc.length));
  return 'ride-' + out;
}

function login_(req) {
  checkTeamCode_(req.teamCode);
  var name = String(req.name || '').trim();
  var pin = String(req.pin || '').trim();
  if (!/^\d{4,8}$/.test(pin)) throw new Error('AUTH: Your PIN must be 4 to 8 digits.');
  var cache = CacheService.getScriptCache();
  var failKey = 'fail_' + name.toLowerCase();
  var fails = Number(cache.get(failKey) || 0);
  if (fails >= 8) throw new Error('AUTH: Too many wrong PINs. Wait 15 minutes or ask a leader to clear your PIN in the Riders tab.');

  return withLock_(function () {
    var sheet = sheet_('Riders');
    var r = readTable_('Riders').filter(function (x) { return String(x.name).trim().toLowerCase() === name.toLowerCase(); })[0];
    if (!r) throw new Error('AUTH: ' + name + ' is not in the Riders list. Ask a leader to add you.');
    var hash = pinHash_(r.name, pin);
    var stored = String(r.pinHash || '').trim();
    // Blank: the first PIN typed becomes the PIN. A plain number typed by a leader is a starting PIN.
    var starting = /^\d{4,8}$/.test(stored);
    if (!stored || (starting && stored === pin)) {
      var col = headers_(sheet).indexOf('PIN Hash') + 1;
      sheet.getRange(r._row, col).setValue(safeCell_(hash));
      r.pinHash = hash;
    } else if (stored !== hash) {
      cache.put(failKey, String(fails + 1), 900);
      throw new Error('AUTH: Wrong PIN for ' + r.name + '. If you forgot it, a leader can clear the "PIN Hash" cell for you in the Riders tab.');
    }
    return { token: makeToken_(r.name, r.pinHash), me: publicRider_(r, true) };
  });
}

function makeToken_(name, pinHash) {
  var payload = Utilities.base64EncodeWebSafe(name, Utilities.Charset.UTF_8).replace(/=+$/, '');
  return payload + '.' + hmac_('tok|' + name + '|' + pinHash + '|' + teamCode_());
}

function verify_(token) {
  var parts = String(token || '').split('.');
  if (parts.length !== 2) throw new Error('AUTH: Please sign in again.');
  var b64 = parts[0];
  while (b64.length % 4) b64 += '=';
  var name;
  try { name = Utilities.newBlob(Utilities.base64DecodeWebSafe(b64)).getDataAsString('UTF-8'); }
  catch (e) { throw new Error('AUTH: Please sign in again.'); }
  var rider = readTable_('Riders').filter(function (r) { return r.name === name; })[0];
  // A new team code or a cleared PIN signs the phone out.
  if (!rider || !rider.pinHash || /^\d{4,8}$/.test(String(rider.pinHash)) || hmac_('tok|' + name + '|' + rider.pinHash + '|' + teamCode_()) !== parts[1]) {
    throw new Error('AUTH: Please sign in again.');
  }
  rider.role = normRole_(rider.role);
  return rider;
}

function normRole_(role) {
  var r = String(role || '').toLowerCase();
  if (r.indexOf('route') >= 0) return 'routemaster';
  if (r.indexOf('lead') >= 0 || r.indexOf('admin') >= 0) return 'leader';
  return 'rider';
}

function isLeader_(me) { return me.role === 'leader' || me.role === 'routemaster'; }

function publicRider_(r, includeEmergency) {
  var out = {
    name: String(r.name), role: normRole_(r.role), phone: String(r.phone || ''), email: String(r.email || ''),
    canDrive: r.canDrive === true || String(r.canDrive).toUpperCase() === 'TRUE'
  };
  if (includeEmergency) { out.emergencyContact = String(r.emergencyContact || ''); out.notifyTopic = String(r.notifyTopic || ''); }
  return out;
}

// ---------------------------------------------------------------- tables --

function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function sheet_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('The "' + name + '" tab is missing. Run setup() from the Illini 4000 menu.');
  return sh;
}

function headers_(sh) {
  var lastCol = sh.getLastColumn();
  if (lastCol === 0) return [];
  return sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
}

function keyOf_(header) {
  var words = String(header).replace(/[^A-Za-z0-9]+/g, ' ').trim().split(' ');
  return words.map(function (w, i) {
    var lw = w.toLowerCase();
    return i === 0 ? lw : lw.charAt(0).toUpperCase() + lw.slice(1);
  }).join('');
}

function tz_() { return ss_().getSpreadsheetTimeZone() || Session.getScriptTimeZone(); }

function cellOut_(v, key) {
  if (v instanceof Date) {
    if (v.getFullYear() < 1900) return Utilities.formatDate(v, tz_(), 'h:mm a');
    if (key === 'date') return Utilities.formatDate(v, tz_(), 'yyyy-MM-dd');
    return v.toISOString();
  }
  return v;
}

function readTable_(name) {
  var sh = sheet_(name);
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  var keys = values[0].map(keyOf_);
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (!hasContent_(row)) continue;
    var obj = {};
    for (var c = 0; c < keys.length; c++) if (keys[c]) obj[keys[c]] = cellOut_(row[c], keys[c]);
    obj._row = i + 1;
    out.push(obj);
  }
  return out;
}

function clean_(obj) {
  var o = {};
  for (var k in obj) if (k !== '_row' && k !== 'pinHash') o[k] = obj[k];
  return o;
}

function safeCell_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean' || typeof v === 'number') return v;
  var s = String(v);
  if (/^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s; // no formula injection
  return s.slice(0, 45000);
}

// Empty checkboxes count as FALSE, so a row is only "used" if it has real content.
function hasContent_(row) {
  return row.some(function (v) { return v !== '' && v !== false && v !== true; });
}

function appendRow_(name, obj) {
  var sh = sheet_(name);
  var heads = headers_(sh);
  var row = heads.map(function (h) { var k = keyOf_(h); return safeCell_(obj[k] === undefined ? '' : obj[k]); });
  var values = sh.getDataRange().getValues();
  var last = 1;
  for (var i = values.length - 1; i >= 1; i--) if (hasContent_(values[i])) { last = i + 1; break; }
  var r = last + 1;
  if (r > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 100);
  sh.getRange(r, 1, 1, row.length).setValues([row]);
  (CHECKBOX_COLUMNS[name] || []).forEach(function (h) {
    var c = heads.indexOf(h) + 1;
    if (c < 1) return;
    var cell = sh.getRange(r, c);
    if (!cell.getDataValidation()) cell.insertCheckboxes();
    cell.setValue(truthy_(obj[keyOf_(h)]));
  });
  return obj;
}

function findRow_(name, id) {
  var rows = readTable_(name);
  for (var i = 0; i < rows.length; i++) if (String(rows[i].id) === String(id)) return rows[i];
  return null;
}

function patchRow_(name, id, patch, keyName) {
  var sh = sheet_(name);
  var heads = headers_(sh);
  var rows = readTable_(name);
  var match = null;
  keyName = keyName || 'id';
  for (var i = 0; i < rows.length; i++) if (String(rows[i][keyName]) === String(id)) match = rows[i];
  if (!match) throw new Error('Could not find that row in ' + name + ' (it may have been deleted).');
  heads.forEach(function (h, c) {
    var k = keyOf_(h);
    if (Object.prototype.hasOwnProperty.call(patch, k)) {
      sh.getRange(match._row, c + 1).setValue(safeCell_(patch[k]));
      match[k] = patch[k];
    }
  });
  return clean_(match);
}

function config_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('config');
  if (hit) return JSON.parse(hit);
  var cfg = {};
  readTable_('Config').forEach(function (r) { if (r.key) cfg[keyOf_(r.key)] = r.value; });
  cache.put('config', JSON.stringify(cfg), 120);
  return cfg;
}

function setConfig_(key, value) {
  var sh = sheet_('Config');
  var rows = readTable_('Config');
  var hit = rows.filter(function (r) { return r.key === key; })[0];
  if (hit) sh.getRange(hit._row, 2).setValue(value);
  else sh.appendRow([key, value, '']);
  CacheService.getScriptCache().remove('config');
}

function truthy_(v) { return v === true || /^(true|yes|y|1|x)$/i.test(String(v).trim()); }
function num_(v) { var n = Number(v); return v === '' || v === null || isNaN(n) ? '' : n; }

function splitNames_(field) {
  return String(field || '').split(/[,&\/]| and /i).map(function (s) { return s.trim(); }).filter(String);
}
function namesIn_(field) {
  return splitNames_(field).map(function (s) { return s.toLowerCase(); });
}
function includesName_(field, name) {
  var list = namesIn_(field);
  return list.indexOf(String(name).trim().toLowerCase()) >= 0 || list.indexOf('everyone') >= 0 || list.indexOf('all') >= 0;
}

// ------------------------------------------------------------ data reads --

function itinerary_() {
  return readTable_('Itinerary').filter(function (d) { return d.day !== ''; }).map(function (d) {
    return {
      day: Number(d.day), date: String(d.date || ''), from: String(d.from || ''), to: String(d.to || ''),
      plannedMiles: num_(d.plannedMiles), rwgpsLink: String(d.rwgpsLink || ''), routeMiles: num_(d.routeMiles),
      elevationGainFt: num_(d.elevationGainFt), startLat: num_(d.startLat), startLon: num_(d.startLon),
      endLat: num_(d.endLat), endLon: num_(d.endLon), stayoverId: String(d.stayoverId || ''),
      driver: String(d.driver || ''), routeLeader: String(d.routeLeader || ''), restDay: truthy_(d.restDay),
      routeNotes: String(d.routeNotes || ''), notesFromPreviousRiders: String(d.notesFromPreviousRiders || '')
    };
  }).sort(function (a, b) { return a.day - b.day; });
}

function stayovers_() {
  return readTable_('Stayovers').filter(function (s) { return s.id !== ''; }).map(function (s) {
    var o = clean_(s);
    Object.keys(o).forEach(function (k) { if (typeof o[k] !== 'boolean') o[k] = String(o[k]); });
    o.id = String(s.id); o.lat = num_(s.lat); o.lon = num_(s.lon); o.confirmed = truthy_(s.confirmed);
    return o;
  });
}

function duties_() {
  return readTable_('Duties').filter(function (d) { return d.duty; }).map(function (d) {
    return { id: String(d.id), day: Number(d.day), person: String(d.person || ''), duty: String(d.duty), details: String(d.details || ''),
      done: truthy_(d.done), doneBy: String(d.doneBy || ''), doneAt: String(d.doneAt || '') };
  });
}

function bootstrap_(me) {
  var cfg = config_();
  var conf = {
    teamName: cfg.teamName || 'Illini 4000', tripYear: String(cfg.tripYear || ''),
    confirmDaysAhead: Number(cfg.confirmDaysAhead || 5), emergencyInfo: String(cfg.emergencyInfo || '')
  };
  if (isLeader_(me) && cfg.rootFolderId) conf.driveFolderUrl = 'https://drive.google.com/drive/folders/' + cfg.rootFolderId;
  var leader = isLeader_(me);
  return {
    config: conf,
    me: publicRider_(me, true),
    riders: readTable_('Riders').filter(function (r) { return r.name; }).map(function (r) { return publicRider_(r, leader); }),
    itinerary: itinerary_(),
    stayovers: stayovers_(),
    duties: duties_()
  };
}

function list_(me, sheet, day) {
  if (LISTABLE.indexOf(sheet) < 0) throw new Error('You cannot list ' + sheet);
  var rows = readTable_(sheet).filter(function (r) { return r.id !== ''; });
  if (day !== undefined && day !== null && day !== '') rows = rows.filter(function (r) { return Number(r.day) === Number(day); });
  if (sheet === 'Journals') {
    rows = rows.filter(function (r) { return r.visibility !== 'private' || r.author === me.name; });
  }
  return rows.map(function (r) {
    var o = clean_(r);
    o.id = String(o.id); o.day = Number(o.day);
    return o;
  });
}

// ----------------------------------------------------------- data writes --

function add_(me, sheet, row) {
  if (ADDABLE.indexOf(sheet) < 0) throw new Error('You cannot add to ' + sheet);
  row = row || {};
  if (!row.id) row.id = newId_();
  var existing = findRow_(sheet, row.id);
  if (existing) return clean_(existing); // already saved (the phone retried)
  if (sheet === 'Journals' && row.visibility === 'phone') throw new Error('Phone-only journal entries stay on the phone.');
  row.timestamp = row.timestamp || new Date().toISOString();
  var owner = OWNER_COLUMN[sheet];
  if (owner && (CHOOSABLE_OWNER.indexOf(sheet) < 0 || !row[owner])) row[owner] = me.name;
  if (sheet === 'Gas' && !row.total && row.gallons && row.pricePerGallon) row.total = Math.round(row.gallons * row.pricePerGallon * 100) / 100;
  if (sheet === 'Reports' && !row.status) row.status = 'Open';
  if (sheet === 'Reports' && row.category === 'Van accident') notifyLeaders_('Van accident reported by ' + me.name, row.text + '\n\n' + (row.details || ''));
  appendRow_(sheet, row);
  return row;
}

function canEdit_(me, sheet, row) {
  if (isLeader_(me)) return true;
  var owner = OWNER_COLUMN[sheet];
  return owner && includesName_(row[owner], me.name);
}

function update_(me, sheet, id, patch) {
  if (ADDABLE.indexOf(sheet) < 0 && sheet !== 'Media') throw new Error('You cannot edit ' + sheet);
  var row = findRow_(sheet, id);
  if (!row) throw new Error('That entry no longer exists.');
  if (!canEdit_(me, sheet, row)) throw new Error('Only the person who added this (or a leader) can change it.');
  var p = {};
  for (var k in patch) if (k !== 'id' && k !== 'timestamp' && k !== OWNER_COLUMN[sheet]) p[k] = patch[k];
  if (sheet === 'Media') p = patch && patch.caption !== undefined ? { caption: patch.caption } : {};
  if (sheet === 'Reports' && p.status === 'Resolved') p.resolvedBy = me.name;
  return patchRow_(sheet, id, p);
}

function remove_(me, sheet, id) {
  if (ADDABLE.indexOf(sheet) < 0 && sheet !== 'Media') throw new Error('You cannot delete from ' + sheet);
  var row = findRow_(sheet, id);
  if (!row) return { removed: true };
  if (!canEdit_(me, sheet, row)) throw new Error('Only the person who added this (or a leader) can delete it.');
  if (sheet === 'Media' && row.driveFileId) {
    try {
      var f = DriveApp.getFileById(String(row.driveFileId));
      if (inAppFolders_(f)) f.setTrashed(true);
    } catch (e) { /* already gone */ }
  }
  sheet_(sheet).deleteRow(row._row);
  return { removed: true };
}

/** True if the file sits in (or one level below) one of the app's Drive folders. */
function inAppFolders_(file) {
  var cfg = config_();
  var ok = ['photosFolderId', 'receiptsFolderId', 'donationsFolderId', 'interviewsFolderId', 'reportsFolderId']
    .map(function (k) { return String(cfg[k] || ''); }).filter(String);
  var parents = file.getParents();
  while (parents.hasNext()) {
    var p = parents.next();
    if (ok.indexOf(p.getId()) >= 0) return true;
    var gp = p.getParents();
    while (gp.hasNext()) if (ok.indexOf(gp.next().getId()) >= 0) return true;
  }
  return false;
}

function confirmStayover_(me, req) {
  var patch = { confirmed: !!req.confirmed, confirmedBy: req.confirmed ? me.name : '', confirmedAt: req.confirmed ? new Date().toISOString() : '' };
  if (req.callNotes !== undefined) patch.callNotes = req.callNotes;
  return patchRow_('Stayovers', req.id, patch);
}

var STAYOVER_EDITABLE = ['checkInTime', 'checkOutTime', 'dinner', 'breakfast', 'lunch', 'showers', 'laundry', 'sleeping', 'wifi',
  'vanParking', 'notes', 'contactName', 'contactPhone', 'contactEmail', 'address', 'callNotes', 'caller'];

function updateStayover_(me, id, patch) {
  var s = findRow_('Stayovers', id);
  if (!s) throw new Error('That stayover no longer exists.');
  if (!isLeader_(me) && !includesName_(s.caller, me.name)) throw new Error('Only leaders and the person calling this stayover can edit it.');
  var p = {};
  STAYOVER_EDITABLE.forEach(function (k) { if (patch && patch[k] !== undefined) p[k] = patch[k]; });
  return patchRow_('Stayovers', id, p);
}

function swapDriver_(me, req) {
  var day = Number(req.day);
  var d = itinerary_().filter(function (x) { return x.day === day; })[0];
  if (!d) throw new Error('Day ' + day + ' is not in the itinerary.');
  var to = String(req.toDriver || '').trim();
  if (!to) throw new Error('Pick who is driving instead.');
  var from = d.driver;
  var next = to;
  if (req.replace && namesIn_(from).length > 1) {
    // Replace just one of several drivers.
    next = splitNames_(from).map(function (s) { return s.toLowerCase() === String(req.replace).toLowerCase() ? to : s; }).join(', ');
  }
  patchRow_('Itinerary', day, { driver: next }, 'day');
  appendRow_('DriverSwaps', { id: req.id || newId_(), timestamp: new Date().toISOString(), day: day, fromDriver: from, toDriver: next, changedBy: me.name, reason: req.reason || '' });
  var rider = readTable_('Riders').filter(function (r) { return String(r.name).toLowerCase() === to.toLowerCase(); })[0];
  if (rider) notifyRider_(rider, 'You are now driving the van on Day ' + day, me.name + ' changed the driver for Day ' + day + ' (' + d.date + ', ' + d.from + ' → ' + d.to + ') from ' + (from || 'nobody') + ' to ' + next + '.' + (req.reason ? '\nReason: ' + req.reason : ''));
  return { day: day, driver: next };
}

function toggleDuty_(me, id, done) {
  var d = findRow_('Duties', id);
  if (!d) throw new Error('That job no longer exists.');
  return patchRow_('Duties', id, { done: !!done, doneBy: done ? me.name : '', doneAt: done ? new Date().toISOString() : '' });
}

function addDuty_(me, row) {
  if (!isLeader_(me)) throw new Error('Only leaders can hand out jobs.');
  row.id = row.id || newId_();
  appendRow_('Duties', { id: row.id, day: row.day, person: row.person, duty: row.duty, details: row.details || '', done: false });
  return row;
}

function newId_() { return Utilities.getUuid().replace(/-/g, '').slice(0, 12); }

// ----------------------------------------------------------- RideWithGPS --

function setRoute_(me, req) {
  var day = Number(req.day);
  var d = itinerary_().filter(function (x) { return x.day === day; })[0];
  if (!d) throw new Error('Day ' + day + ' is not in the itinerary.');
  if (!isLeader_(me) && !includesName_(d.routeLeader, me.name)) throw new Error('Only the route master, leaders or the day\'s route leader can change the route.');
  var patch = {};
  if (req.plannedMiles !== undefined && req.plannedMiles !== '') patch.plannedMiles = Number(req.plannedMiles);
  var warning = '';
  if (req.rwgpsLink !== undefined) {
    patch.rwgpsLink = String(req.rwgpsLink || '').trim();
    if (patch.rwgpsLink) {
      try {
        var r = fetchRwgps_(patch.rwgpsLink);
        patch.routeMiles = Math.round(r.miles * 10) / 10;
        patch.elevationGainFt = Math.round(r.gainFt);
        if (r.firstLat) { patch.startLat = r.firstLat; patch.startLon = r.firstLng; }
        if (r.lastLat) { patch.endLat = r.lastLat; patch.endLon = r.lastLng; }
      } catch (e) {
        warning = e.message;
      }
    } else {
      patch.routeMiles = ''; patch.elevationGainFt = '';
    }
  }
  withLock_(function () { patchRow_('Itinerary', day, patch, 'day'); });
  var updated = itinerary_().filter(function (x) { return x.day === day; })[0];
  return { day: updated, warning: warning };
}

function fetchRwgps_(link) {
  var m = String(link).match(/ridewithgps\.com\/(routes|trips)\/(\d+)/i);
  if (!m) throw new Error('Saved the link, but it does not look like a RideWithGPS route link, so the miles were not read.');
  var kind = m[1].toLowerCase(), id = m[2];
  var cfg = config_();
  var attempts = [{ url: 'https://ridewithgps.com/' + kind + '/' + id + '.json', headers: {} }];
  if (cfg.rwgpsApiKey) {
    attempts.unshift({ url: 'https://ridewithgps.com/api/v1/' + kind + '/' + id + '.json',
      headers: { 'x-rwgps-api-key': String(cfg.rwgpsApiKey), 'x-rwgps-auth-token': String(cfg.rwgpsAuthToken || '') } });
  }
  for (var i = 0; i < attempts.length; i++) {
    try {
      var res = UrlFetchApp.fetch(attempts[i].url, { headers: attempts[i].headers, muteHttpExceptions: true, followRedirects: true });
      if (res.getResponseCode() !== 200) continue;
      var j = JSON.parse(res.getContentText());
      var o = j.route || j.trip || j;
      if (o && o.distance) {
        return { miles: Number(o.distance) / 1609.344, gainFt: Number(o.elevation_gain || 0) * 3.28084,
          firstLat: o.first_lat, firstLng: o.first_lng, lastLat: o.last_lat, lastLng: o.last_lng };
      }
    } catch (e) { /* try the next way */ }
  }
  throw new Error('Saved the link, but RideWithGPS would not share the route details. Make the route public, or add an API key in the Config tab. The planned miles are still shown.');
}

function refreshAllRoutes() {
  var days = itinerary_();
  var n = 0;
  days.forEach(function (d) {
    if (!d.rwgpsLink) return;
    try {
      var r = fetchRwgps_(d.rwgpsLink);
      var patch = { routeMiles: Math.round(r.miles * 10) / 10, elevationGainFt: Math.round(r.gainFt) };
      if (r.firstLat) { patch.startLat = r.firstLat; patch.startLon = r.firstLng; }
      if (r.lastLat) { patch.endLat = r.lastLat; patch.endLon = r.lastLng; }
      patchRow_('Itinerary', d.day, patch, 'day');
      n++;
    } catch (e) { console.warn('Day ' + d.day + ': ' + e.message); }
  });
  try { SpreadsheetApp.getUi().alert('Updated mileage for ' + n + ' day(s) from RideWithGPS.'); } catch (e) { /* run from editor */ }
}

// ---------------------------------------------------------------- uploads --

function folderById_(id) {
  if (!id) return null;
  try { return DriveApp.getFolderById(String(id)); } catch (e) { return null; }
}

function childFolder_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function pad2_(n) { return (Number(n) < 10 ? '0' : '') + Number(n); }

function folderFor_(kind, day, linkedSheet, linkedId) {
  var cfg = config_();
  var key, parent;
  if (kind === 'photo' || kind === 'video') key = 'photosFolderId';
  else if (kind === 'receipt') key = 'receiptsFolderId';
  else if (kind === 'donation') key = 'donationsFolderId';
  else if (kind.indexOf('interview') === 0 || kind === 'release-form') key = 'interviewsFolderId';
  else key = 'reportsFolderId';
  parent = folderById_(cfg[key]);
  if (!parent) throw new Error('The Drive folder for ' + kind + ' files is missing. A leader should run setup() again.');

  if (key === 'photosFolderId') {
    var d = itinerary_().filter(function (x) { return x.day === Number(day); })[0];
    var name = 'Day ' + pad2_(day) + (d ? ' – ' + d.date + ' – ' + d.from + ' to ' + d.to : '');
    return cachedChild_(parent, 'photos_' + day, name);
  }
  if (key === 'interviewsFolderId' && linkedSheet === 'Interviews' && linkedId) {
    var iv = findRow_('Interviews', linkedId);
    var fname = 'Day ' + pad2_(day) + ' – ' + (iv && iv.interviewee ? iv.interviewee : 'Interview ' + linkedId);
    var folder = cachedChild_(parent, 'iv_' + linkedId, fname);
    if (iv && !iv.folderUrl) { try { withLock_(function () { patchRow_('Interviews', linkedId, { folderUrl: folder.getUrl() }); }); } catch (e) { } }
    return folder;
  }
  return parent;
}

function cachedChild_(parent, cacheKey, name) {
  var p = props_();
  var id = p.getProperty('folder_' + cacheKey);
  var f = folderById_(id);
  if (f && !f.isTrashed()) return f;
  return withLock_(function () {
    var again = folderById_(p.getProperty('folder_' + cacheKey));
    if (again && !again.isTrashed()) return again;
    var made = childFolder_(parent, name.replace(/[\\\/]/g, '-').slice(0, 120));
    p.setProperty('folder_' + cacheKey, made.getId());
    return made;
  });
}

function fileNameFor_(me, req) {
  var base = String(req.fileName || 'file').replace(/[\\\/]/g, '-');
  var prefix = 'D' + pad2_(req.day) + ' ';
  if (req.kind === 'receipt' || req.kind === 'donation') {
    return prefix + (req.caption ? String(req.caption).slice(0, 60) + ' ' : '') + me.name + ' ' + base;
  }
  return prefix + me.name + ' ' + base;
}

function finishUpload_(me, req, file) {
  var cfg = config_();
  var share = (req.kind === 'photo' || req.kind === 'video') && truthy_(cfg.sharePhotosWithLink);
  if (share) {
    try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); }
    catch (e) { console.warn('Could not share with link (domain policy?): ' + e.message); }
  }
  var media = {
    id: req.id, timestamp: new Date().toISOString(), day: Number(req.day), uploader: me.name, kind: req.kind,
    fileName: file.getName(), mimeType: req.mimeType, size: Number(req.size || file.getSize()), driveFileId: file.getId(),
    driveUrl: file.getUrl(), caption: req.caption || '', linkedSheet: req.linkedSheet || '', linkedId: req.linkedId || ''
  };
  withLock_(function () {
    if (!findRow_('Media', req.id)) appendRow_('Media', media);
    if (req.linkedSheet && req.linkedId && ADDABLE.indexOf(req.linkedSheet) >= 0) {
      var heads = headers_(sheet_(req.linkedSheet)).map(keyOf_);
      var col = ['receiptLink', 'fileLink'].filter(function (k) { return heads.indexOf(k) >= 0; })[0];
      if (col) {
        try {
          var row = findRow_(req.linkedSheet, req.linkedId);
          if (row) { var p = {}; p[col] = row[col] ? row[col] + '\n' + file.getUrl() : file.getUrl(); patchRow_(req.linkedSheet, req.linkedId, p); }
        } catch (e) { console.warn(e.message); }
      }
    }
  });
  return media;
}

/** Small files (up to ~5 MB) in one request. */
function upload_(me, req) {
  var existing = findRow_('Media', req.id);
  if (existing) return clean_(existing);
  var folder = folderFor_(req.kind, req.day, req.linkedSheet, req.linkedId);
  var blob = Utilities.newBlob(Utilities.base64Decode(req.data), req.mimeType || 'application/octet-stream', fileNameFor_(me, req));
  var file = folder.createFile(blob);
  if (req.caption) file.setDescription(String(req.caption));
  return finishUpload_(me, req, file);
}

/** Big files (videos, long recordings) go to Drive in pieces. */
function uploadStart_(me, req) {
  var existing = findRow_('Media', req.id);
  if (existing) return { done: true, media: clean_(existing) };
  var folder = folderFor_(req.kind, req.day, req.linkedSheet, req.linkedId);
  var meta = { name: fileNameFor_(me, req), parents: [folder.getId()], description: req.caption || '' };
  var res = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true', {
    method: 'post', contentType: 'application/json; charset=UTF-8', payload: JSON.stringify(meta), muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), 'X-Upload-Content-Type': req.mimeType || 'application/octet-stream', 'X-Upload-Content-Length': String(req.size) }
  });
  if (res.getResponseCode() !== 200) throw new Error('Google Drive did not accept the upload (' + res.getResponseCode() + '): ' + res.getContentText().slice(0, 200));
  var h = res.getAllHeaders();
  var loc = h.Location || h.location;
  if (!loc) throw new Error('Google Drive did not return an upload address.');
  var state = { loc: loc, req: { id: req.id, kind: req.kind, day: req.day, mimeType: req.mimeType, size: req.size, caption: req.caption || '', linkedSheet: req.linkedSheet || '', linkedId: req.linkedId || '', fileName: req.fileName } };
  state.at = Date.now();
  pruneUploads_();
  props_().setProperty('up_' + req.id, JSON.stringify(state));
  return { done: false, next: 0 };
}

/** Forget upload addresses older than 6 days (Drive keeps them for a week). */
function pruneUploads_() {
  var all = props_().getProperties();
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('up_') !== 0) return;
    try { if (Date.now() - Number(JSON.parse(all[k]).at || 0) > 6 * 86400000) props_().deleteProperty(k); }
    catch (e) { props_().deleteProperty(k); }
  });
}

function uploadChunk_(me, req) {
  var raw = props_().getProperty('up_' + req.id);
  if (!raw) {
    var existing = findRow_('Media', req.id);
    if (existing) return { done: true, media: clean_(existing) };
    throw new Error('UPLOAD_EXPIRED');
  }
  var st = JSON.parse(raw);
  var total = Number(st.req.size);
  var opts = { method: 'put', muteHttpExceptions: true, followRedirects: false, headers: {} };
  if (req.probe) {
    opts.headers['Content-Range'] = 'bytes */' + total;
    opts.payload = '';
  } else {
    var bytes = Utilities.base64Decode(req.data);
    var start = Number(req.offset);
    opts.headers['Content-Range'] = 'bytes ' + start + '-' + (start + bytes.length - 1) + '/' + total;
    opts.contentType = st.req.mimeType || 'application/octet-stream';
    opts.payload = bytes;
  }
  var res = UrlFetchApp.fetch(st.loc, opts);
  var code = res.getResponseCode();
  if (code === 308) {
    var h = res.getAllHeaders();
    var range = h.Range || h.range || '';
    var m = String(range).match(/bytes=0-(\d+)/);
    return { done: false, next: m ? Number(m[1]) + 1 : 0 };
  }
  if (code === 200 || code === 201) {
    var fileId = JSON.parse(res.getContentText()).id;
    var file = DriveApp.getFileById(fileId);
    props_().deleteProperty('up_' + req.id);
    st.req.size = total;
    return { done: true, media: finishUpload_(me, st.req, file) };
  }
  if (code === 404 || code === 410) { props_().deleteProperty('up_' + req.id); throw new Error('UPLOAD_EXPIRED'); }
  throw new Error('Google Drive upload failed (' + code + '). It will retry.');
}

// -------------------------------------------------------------- reminders --

function todayStr_(offsetDays) {
  var d = new Date(Date.now() + (offsetDays || 0) * 86400000);
  return Utilities.formatDate(d, tz_(), 'yyyy-MM-dd');
}

function daysBetween_(a, b) {
  return Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 86400000);
}

/** The same list the app shows under "Your jobs today". */
function responsibilitiesFor_(name, data, today) {
  var items = [];
  var tomorrow = todayStr_(1);
  var it = data.itinerary;
  var todayDay = it.filter(function (d) { return d.date === today; })[0];
  var tomorrowDay = it.filter(function (d) { return d.date === tomorrow; })[0];
  if (todayDay && includesName_(todayDay.driver, name)) items.push('You are driving the van today (Day ' + todayDay.day + ': ' + todayDay.from + ' → ' + todayDay.to + '). Log gas and receipts in the app.');
  if (tomorrowDay && includesName_(tomorrowDay.driver, name)) items.push('Heads-up: you drive the van tomorrow (Day ' + tomorrowDay.day + ').');
  [todayDay, tomorrowDay].forEach(function (d) {
    if (d && includesName_(d.routeLeader, name) && !d.rwgpsLink) items.push('Add the RideWithGPS route for Day ' + d.day + ' (' + d.from + ' → ' + d.to + ').');
  });
  if (todayDay) {
    data.duties.forEach(function (j) {
      if (j.day === todayDay.day && !j.done && includesName_(j.person, name)) items.push(j.duty + (j.details ? ': ' + j.details : ''));
    });
  }
  var ahead = Number(data.config.confirmDaysAhead || 5);
  data.stayovers.forEach(function (s) {
    if (s.confirmed || !includesName_(s.caller, name)) return;
    var first = it.filter(function (d) { return d.stayoverId === s.id; })[0];
    if (!first || !first.date) return;
    var gap = daysBetween_(today, first.date);
    if (gap >= 0 && gap <= ahead) {
      items.push('Call to confirm ' + s.name + ' for Day ' + first.day + ' (' + first.date + ')' +
        (s.contactName ? ': ' + s.contactName : '') + (s.contactPhone ? ', ' + s.contactPhone : '') + '. Tick it in the app when done.');
    }
  });
  return items;
}

function sendDailyReminders() {
  var cfg = config_();
  var data = {
    config: { confirmDaysAhead: Number(cfg.confirmDaysAhead || 5) },
    itinerary: itinerary_(), stayovers: stayovers_(), duties: duties_()
  };
  var today = todayStr_(0);
  var dayRow = data.itinerary.filter(function (d) { return d.date === today; })[0];
  var sent = 0;
  readTable_('Riders').forEach(function (r) {
    if (!r.name) return;
    var items = responsibilitiesFor_(String(r.name), data, today);
    if (!items.length) return;
    var title = (dayRow ? 'Day ' + dayRow.day + ': ' : '') + 'your jobs today';
    var body = 'Hi ' + String(r.name).split(' ')[0] + ',\n\n' + items.map(function (x) { return '• ' + x; }).join('\n') +
      (cfg.appUrl ? '\n\nOpen the app: ' + cfg.appUrl : '') + '\n\nRide safe!';
    notifyRider_(r, title, body);
    sent++;
  });
  console.log('Sent reminders to ' + sent + ' rider(s).');
  return sent;
}

function notifyRider_(rider, title, body) {
  var cfg = config_();
  if (rider.notifyTopic) {
    try {
      UrlFetchApp.fetch('https://ntfy.sh/' + encodeURIComponent(String(rider.notifyTopic).trim()), {
        method: 'post', payload: body, muteHttpExceptions: true,
        headers: { Title: title.replace(/[^\x20-\x7E]/g, ''), Tags: 'bike', Click: String(cfg.appUrl || '') }
      });
    } catch (e) { console.warn('ntfy failed for ' + rider.name + ': ' + e.message); }
  }
  if (rider.email && truthy_(cfg.sendReminderEmails === undefined ? 'TRUE' : cfg.sendReminderEmails)) {
    try {
      MailApp.sendEmail({ to: String(rider.email), subject: '[' + (cfg.teamName || 'Illini 4000') + '] ' + title, body: body, name: String(cfg.teamName || 'Illini 4000') + ' Ride App' });
    } catch (e) { console.warn('Email failed for ' + rider.name + ': ' + e.message); }
  }
}

function notifyLeaders_(title, body) {
  readTable_('Riders').forEach(function (r) { if (normRole_(r.role) !== 'rider') notifyRider_(r, title, body); });
}

// ------------------------------------------------------------- setup/menu --

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Illini 4000')
    .addItem('Set up / repair tabs and folders', 'setup')
    .addItem('Refresh mileage from RideWithGPS', 'refreshAllRoutes')
    .addItem('Send today\'s reminders now', 'sendRemindersFromMenu')
    .addSeparator()
    .addItem('Fill with sample data (testing only)', 'loadSampleData')
    .addToUi();
}

function sendRemindersFromMenu() {
  var n = sendDailyReminders();
  SpreadsheetApp.getUi().alert('Sent reminders to ' + n + ' rider(s).');
}

/** Run once. Safe to run again: it only adds what is missing. */
function setup() {
  var ss = ss_();
  Object.keys(SCHEMA).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    var want = SCHEMA[name];
    var have = headers_(sh);
    if (have.length === 0 || have.join('') === '') {
      sh.getRange(1, 1, 1, want.length).setValues([want]);
    } else {
      want.forEach(function (h) { if (have.indexOf(h) < 0) { sh.getRange(1, sh.getLastColumn() + 1).setValue(h); } });
    }
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, sh.getLastColumn()).setFontWeight('bold').setBackground('#13294B').setFontColor('#ffffff');
    var heads = headers_(sh);
    // Tabs leaders fill in by hand get ready-made checkboxes; the app adds them row by row elsewhere.
    if (['Riders', 'Itinerary', 'Stayovers', 'Duties'].indexOf(name) >= 0) {
      (CHECKBOX_COLUMNS[name] || []).forEach(function (h) {
        var c = heads.indexOf(h) + 1;
        if (c > 0) sh.getRange(2, c, 200, 1).insertCheckboxes();
      });
    }
    if (name === 'Itinerary') {
      var dc = heads.indexOf('Date') + 1;
      if (dc > 0) sh.getRange(2, dc, Math.max(sh.getMaxRows() - 1, 1), 1).setNumberFormat('yyyy-mm-dd');
    }
    if (name === 'Stayovers') {
      ['Check-in Time', 'Check-out Time', 'Contact Phone'].forEach(function (h) {
        var c = heads.indexOf(h) + 1;
        if (c > 0) sh.getRange(2, c, Math.max(sh.getMaxRows() - 1, 1), 1).setNumberFormat('@');
      });
    }
    if (name === 'Riders') {
      var pc = heads.indexOf('Phone') + 1;
      if (pc > 0) sh.getRange(2, pc, Math.max(sh.getMaxRows() - 1, 1), 1).setNumberFormat('@');
    }
  });
  var first = ss.getSheets()[0];
  if (first.getName() !== 'Config' && /^Sheet\d*$/.test(first.getName()) && first.getLastRow() === 0) ss.deleteSheet(first);

  // Config defaults
  var cfgSheet = sheet_('Config');
  var have = readTable_('Config').map(function (r) { return r.key; });
  CONFIG_DEFAULTS.forEach(function (row) { if (have.indexOf(row[0]) < 0) cfgSheet.appendRow(row); });
  CacheService.getScriptCache().remove('config');
  var cfg = config_();
  if (!cfg.teamCode) setConfig_('Team Code', newTeamCode_());

  // Drive folders
  cfg = config_();
  var root = folderById_(cfg.rootFolderId);
  if (!root) {
    var parents = DriveApp.getFileById(ss.getId()).getParents();
    var home = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
    root = home.createFolder((cfg.teamName || 'Illini 4000') + ' ' + (cfg.tripYear || '') + ' – App Files');
    setConfig_('Root Folder ID', root.getId());
  }
  [['Photos Folder ID', 'Photos & Videos (by day)'], ['Receipts Folder ID', 'Receipts'], ['Donations Folder ID', 'Donations'],
   ['Interviews Folder ID', 'Portrait Interviews'], ['Reports Folder ID', 'Reports & Accidents']].forEach(function (pair) {
    if (!folderById_(config_()[keyOf_(pair[0])])) setConfig_(pair[0], childFolder_(root, pair[1]).getId());
  });
  secret_();

  // Daily reminder trigger
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'sendDailyReminders') ScriptApp.deleteTrigger(t); });
  var hour = Math.max(0, Math.min(23, Number(config_().reminderHour || 6)));
  ScriptApp.newTrigger('sendDailyReminders').timeBased().everyDays(1).atHour(hour).create();

  var msg = 'Setup finished.\n\nTeam code: ' + config_().teamCode +
    '\nApp files folder: ' + root.getUrl() +
    '\n\nNext: Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone). Then put the web app URL into public/config.json in the GitHub repo.';
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { console.log(msg); }
}

/** Fills the tabs with a short made-up trip so you can try the app. */
function loadSampleData() {
  var ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (e) { }
  if (ui && ui.alert('Add sample riders, days and stayovers? Use this only on a test copy.', ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;
  var start = new Date(); start.setDate(start.getDate() - 2);
  var date = function (i) { var d = new Date(start); d.setDate(d.getDate() + i); return Utilities.formatDate(d, tz_(), 'yyyy-MM-dd'); };
  var riders = [['Avery Chen', 'Leader', '2175550101', '', true, '', ''], ['Jordan Patel', 'Route master', '2175550102', '', true, '', ''],
    ['Sam Rivera', 'Rider', '2175550103', '', true, '', ''], ['Maya Johnson', 'Rider', '2175550104', '', false, '', ''],
    ['Leo Kim', 'Rider', '2175550105', '', true, '', '']];
  riders.forEach(function (r) { appendRow_('Riders', { name: r[0], role: r[1], phone: r[2], email: r[3], canDrive: r[4] }); });
  var days = [
    ['New York, NY', 'Princeton, NJ', 52, 40.7128, -74.006, 40.3573, -74.6672, 'S1', 'Sam Rivera'],
    ['Princeton, NJ', 'Philadelphia, PA', 48, 40.3573, -74.6672, 39.9526, -75.1652, 'S2', 'Leo Kim'],
    ['Philadelphia, PA', 'Lancaster, PA', 71, 39.9526, -75.1652, 40.0379, -76.3055, 'S3', 'Avery Chen'],
    ['Lancaster, PA', 'Harrisburg, PA', 44, 40.0379, -76.3055, 40.2732, -76.8867, 'S4', 'Jordan Patel'],
    ['Harrisburg, PA', 'Chambersburg, PA', 58, 40.2732, -76.8867, 39.9376, -77.6611, 'S5', 'Sam Rivera'],
    ['Chambersburg, PA', 'Cumberland, MD', 82, 39.9376, -77.6611, 39.6529, -78.7625, 'S6', 'Leo Kim']];
  days.forEach(function (d, i) {
    appendRow_('Itinerary', { day: i + 1, date: date(i), from: d[0], to: d[1], plannedMiles: d[2], startLat: d[3], startLon: d[4], endLat: d[5], endLon: d[6],
      stayoverId: d[7], driver: d[8], routeLeader: 'Jordan Patel', restDay: false, routeNotes: '', notesFromPreviousRiders: '' });
    appendRow_('Stayovers', { id: d[7], name: 'Sample host in ' + d[1], address: '', city: d[1], lat: d[5], lon: d[6], contactName: 'Host contact',
      contactPhone: '2175550199', checkInTime: '4:00 PM', checkOutTime: '8:00 AM', dinner: 'Donated', breakfast: 'Bring our own', showers: '4',
      caller: riders[(i + 2) % riders.length][0], confirmed: i < 2 });
  });
  appendRow_('Duties', { id: newId_(), day: 3, person: 'Maya Johnson', duty: 'Write the day\'s blog post', details: '', done: false });
  appendRow_('Duties', { id: newId_(), day: 3, person: 'Everyone', duty: 'Pump tires before leaving', details: '', done: false });
  if (ui) ui.alert('Sample data added.');
}
