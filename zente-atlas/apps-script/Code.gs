/**
 * ZENTE ATLAS — Google Sheet bridge
 * Paste into: your rolodex Google Sheet → Extensions → Apps Script.
 * Serves the "ZENTES_WORLD_Venues" tab to the Atlas app:
 *   - public columns to anyone with the link
 *   - private columns ONLY when the owner key is sent
 * Plus menu tools: geocode addresses, pull Texas liquor sales, set owner key.
 */
const TAB = 'ZENTES_WORLD_Venues';
const PRIVATE = ['Use','Status','Deal','Rental fee $','Rent $/mo','Lease','Liquor sales $/mo','Owner','Operator',
  'Contact','Contact phone','Contact email','Last visit','Notes','Sources','Score'];

function onOpen() {
  SpreadsheetApp.getUi().createMenu('ZENTE Atlas')
    .addItem('Set owner key…', 'setOwnerKey')
    .addItem('Fill missing map coordinates', 'geocodeVenues')
    .addItem('Update Texas liquor sales', 'updateTexasLiquor')
    .addToUi();
}

/* ---------- web app ---------- */
function doGet(e) {
  const admin = !!(e && e.parameter && e.parameter.key && e.parameter.key === ownerKey_());
  const sh = sheet_(); if (!sh) return json_({ venues: [], error: 'Tab ' + TAB + ' not found. Run a sync from ZENTE\'S WORLD first.' });
  const v = sh.getDataRange().getDisplayValues(); const H = v[0].map(String);
  const venues = v.slice(1).filter(r => r.some(String)).map(r => {
    const o = {};
    H.forEach((h, i) => { if (!h) return; if (!admin && (PRIVATE.indexOf(h) >= 0 || h.indexOf('★') === 0)) return; o[h] = r[i]; });
    return o;
  });
  return json_({ venues, admin, updated: new Date().toISOString() });
}

function doPost(e) {
  let body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (_) { return json_({ ok: false, error: 'bad json' }); }
  if (!body.key || body.key !== ownerKey_()) return json_({ ok: false, error: 'unauthorized' });
  const sh = sheet_(); if (!sh) return json_({ ok: false, error: 'tab missing' });
  const H = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  if (body.action === 'add') {
    // ID stays blank on purpose: ZENTE'S WORLD adopts new rows on its next sync and assigns the ID.
    const row = H.map(h => h === 'ID' ? '' : (body.venue && body.venue[h] !== undefined ? body.venue[h] : ''));
    sh.appendRow(row.map(safe_));
    return json_({ ok: true });
  }
  const r = rowById_(sh, H, body.id); if (!r) return json_({ ok: false, error: 'row not found' });
  if (body.action === 'setCoords') {
    setCell_(sh, H, r, 'Lat', body.lat); setCell_(sh, H, r, 'Lng', body.lng); return json_({ ok: true });
  }
  if (body.action === 'setField') {
    if (H.indexOf(body.header) < 0) return json_({ ok: false, error: 'unknown column' });
    setCell_(sh, H, r, body.header, body.value); return json_({ ok: true });
  }
  return json_({ ok: false, error: 'unknown action' });
}

/* ---------- menu tools ---------- */
function setOwnerKey() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('ZENTE Atlas owner key', 'Choose a long private passphrase. You type it into the Atlas "Owner" button to see private intel.', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const k = res.getResponseText().trim(); if (k.length < 10) { ui.alert('Use at least 10 characters.'); return; }
  PropertiesService.getScriptProperties().setProperty('ATLAS_KEY', k); ui.alert('Owner key saved.');
}

function geocodeVenues() {
  const sh = sheet_(); const v = sh.getDataRange().getValues(); const H = v[0].map(String);
  const c = n => H.indexOf(n); let n = 0;
  for (let i = 1; i < v.length; i++) {
    const r = v[i]; if (!r[c('Name')] || (r[c('Lat')] !== '' && r[c('Lng')] !== '')) continue;
    const q = [r[c('Address')] || r[c('Name')], r[c('City')], r[c('Country')]].filter(String).join(', ');
    try {
      const g = Maps.newGeocoder().geocode(q);
      if (g.status === 'OK' && g.results.length) { const loc = g.results[0].geometry.location;
        sh.getRange(i + 1, c('Lat') + 1).setValue(loc.lat); sh.getRange(i + 1, c('Lng') + 1).setValue(loc.lng); n++; }
    } catch (_) {}
    Utilities.sleep(200);
  }
  SpreadsheetApp.getActive().toast(n + ' venues placed on the map.', 'ZENTE Atlas');
}

/** Average of the last 12 months of mixed-beverage gross receipts (Texas Comptroller, public data). */
function updateTexasLiquor() {
  const sh = sheet_(); const v = sh.getDataRange().getValues(); const H = v[0].map(String);
  const c = n => H.indexOf(n); let n = 0;
  for (let i = 1; i < v.length; i++) {
    const r = v[i]; const addr = String(r[c('Address')] || '').toUpperCase().replace(/[.,#]/g, ' ');
    const m = addr.match(/^(\d+)[A-Z]?\s+(?:(?:N|S|E|W|NORTH|SOUTH|EAST|WEST)\s+)?([A-Z0-9]+)/); if (!m) continue;
    if (!/^(usa|us|united states)$/i.test(String(r[c('Country')] || 'USA'))) continue;
    const city = String(r[c('City')] || '').toUpperCase().replace(/'/g, '');
    const where = "upper(location_address) like '" + m[1] + '%' + m[2] + "%'" + (city ? " AND location_city='" + city + "'" : '');
    const url = 'https://data.texas.gov/resource/naix-2893.json?$limit=12&$order=obligation_end_date_yyyymmdd%20DESC&$where=' + encodeURIComponent(where);
    try {
      const rows = JSON.parse(UrlFetchApp.fetch(url, { muteHttpExceptions: true }).getContentText());
      if (!rows.length) continue;
      const name = rows[0].location_name; const same = rows.filter(x => x.location_name === name);
      const avg = Math.round(same.reduce((s, x) => s + (+x.total_receipts || 0), 0) / same.length);
      sh.getRange(i + 1, c('Liquor sales $/mo') + 1).setValue(avg);
      const ni = c('Notes'); const note = 'TX liquor: ' + name + ' (permit ' + rows[0].tabc_permit_number + ', since ' + String(rows[0].responsibility_begin_date_yyyymmdd).slice(0, 10) + ')';
      if (ni >= 0 && String(r[ni]).indexOf('TX liquor:') < 0) sh.getRange(i + 1, ni + 1).setValue([r[ni], note].filter(String).join(' · '));
      n++;
    } catch (_) {}
    Utilities.sleep(250);
  }
  SpreadsheetApp.getActive().toast(n + ' Texas venues updated with liquor sales.', 'ZENTE Atlas');
}

/* ---------- helpers ---------- */
function sheet_() { return SpreadsheetApp.getActive().getSheetByName(TAB); }
function ownerKey_() { return PropertiesService.getScriptProperties().getProperty('ATLAS_KEY') || ''; }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function safe_(v) { v = v === null || v === undefined ? '' : v; return typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v; }
function rowById_(sh, H, id) { if (!id) return 0; const ic = H.indexOf('ID'); if (ic < 0) return 0;
  const ids = sh.getRange(2, ic + 1, Math.max(1, sh.getLastRow() - 1), 1).getValues(); for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2; return 0; }
function setCell_(sh, H, row, header, val) { const ci = H.indexOf(header); if (ci >= 0) sh.getRange(row, ci + 1).setValue(safe_(val)); }
