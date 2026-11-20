/* ZENTE ATLAS — venues & spaces map
   Data: your Google Sheet (via the Apps Script bridge) or the bundled venues.json.
   Private columns only ever arrive from the sheet when the owner key is supplied. */
(() => {
const C = window.ATLAS_CONFIG || {};
const HEAD = {"ID":"id","Name":"name","City":"city","Country":"country","Neighborhood":"area","Address":"address","Lat":"lat","Lng":"lng","Type":"type","Use":"use","Status":"status","Capacity":"cap","Sq ft":"sqft","Sound system":"sound","Indoor / Outdoor":"io","Curfew":"late","Alcohol":"alc","Deal":"deal","Rental fee $":"fee","Rent $/mo":"rent","Lease":"lease","Liquor sales $/mo":"liq","Owner":"owner","Operator":"operator","Contact":"contact","Contact phone":"cphone","Contact email":"cemail","Website":"link","Instagram":"ig","Opened":"opened","Genres / vibe":"genres","Public description":"desc","Last visit":"last","Notes":"notes","Sources":"sources","Verified":"verified","Score":"score"};
const KEYHEAD = Object.fromEntries(Object.entries(HEAD).map(([h,k]) => [k,h]));
const PRIVATE = new Set(["use","status","deal","fee","rent","lease","liq","owner","operator","contact","cphone","cemail","last","notes","sources","score"]);
const TYPE_COLORS = {"Club":"#c9a961","Concert venue":"#8e7cc3","Event space":"#6fa8dc","Warehouse":"#e06666","Rooftop":"#f6b26b","Outdoor / Ranch":"#93c47d","Festival grounds":"#6aa84f","After-hours":"#c27ba0","Theater":"#b4a7d6","Hotel":"#76a5af","Gallery / Art space":"#ffd966","Bar / Lounge":"#d5a6bd","Private house":"#9fc5e8","Restaurant":"#e6b8af","Other":"#999999"};
const STATUS_COLORS = {"Booked / Partner":"#6aa84f","Negotiating":"#ffd966","Visited":"#6fa8dc","Contacted":"#8e7cc3","Pass":"#e06666","Scouting":"#8d8c94"};

const $ = s => document.querySelector(s);
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const num = v => { const n = parseFloat(String(v ?? "").replace(/[^0-9.\-]/g, "")); return isFinite(n) ? n : null; };
const fmtN = v => { const n = num(v); return n === null ? "" : n.toLocaleString(); };
const money = v => { if (v === undefined || v === null || v === "") return ""; const s = String(v); if (/[–-]/.test(s.replace(/^-/, ""))) return "$" + s.split(/\s*[–-]\s*/).map(x => fmtN(x) || x).join(" – "); const n = num(s); return n === null ? s : "$" + n.toLocaleString(); };
const normName = s => String(s || "").toLowerCase().replace(/^the\s+/, "").replace(/[^a-z0-9]/g, "");
const store = { get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (_) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} } };
const params = new URLSearchParams(location.search);

const S = {
  venues: [], admin: false, key: store.get("atlas-key", ""), source: "",
  f: { city: params.get("city") || "", types: new Set(), cap: "", io: "", late: false, q: "", status: "" },
  sel: null, picked: new Set((params.get("ids") || "").split(",").filter(Boolean)),
  present: params.get("present") === "1", scout: [], map: null, mapReady: false,
  promoters: [], media: [], view: params.get("view") || "venues", selScene: null
};

function toast(msg, ms = 3500) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, ms); }

/* ---------------- data ---------------- */
function fromSheetRow(o) { const v = {}; for (const [h, val] of Object.entries(o)) { if (h.startsWith("★ ")) { (v.crit = v.crit || {})[h.slice(2)] = val; continue; } const k = HEAD[h]; if (k) v[k] = val; } return v; }
async function load() {
  let rows = null;
  if (C.SHEET_API) {
    try {
      const u = C.SHEET_API + (S.key ? (C.SHEET_API.includes("?") ? "&" : "?") + "key=" + encodeURIComponent(S.key) : "");
      const r = await fetch(u); const j = await r.json();
      rows = (j.venues || []).map(fromSheetRow); S.admin = !!j.admin; S.source = "Live from Google Sheet";
      S.promoters = (j.promoters || []).filter(p => p.Name); S.media = (j.media || []).filter(m => m.Name);
      if (S.key && !j.admin) { toast("Owner key not accepted — showing the public view."); }
    } catch (e) { toast("Couldn't reach your Google Sheet — showing the saved list."); }
  }
  if (!rows) {
    const r = await fetch("venues.json"); rows = await r.json(); S.source = "Starter list"; S.admin = false;
    if (S.key) toast("Private data needs your Google Sheet connected (see README).");
  }
  if (S.present) S.admin = false;
  const geo = store.get("atlas-geo", {});
  S.venues = rows.filter(v => v.name).map((v, i) => {
    const id = v.id || "v" + normName(v.name) + normName(v.city);
    let lat = num(v.lat), lng = num(v.lng);
    const gk = geoKey(v); if ((lat === null || lng === null) && geo[gk]) { lat = geo[gk][0]; lng = geo[gk][1]; v._geoLocal = true; }
    return { ...v, _id: id, _lat: lat, _lng: lng };
  });
  document.querySelectorAll(".owner-only").forEach(el => el.hidden = !S.admin);
  $("#ownerBtn").classList.toggle("on", S.admin);
  $("#ownerBtn").textContent = S.admin ? "Owner ✓" : "Owner";
  $("#src").textContent = S.source + (S.admin ? " · owner view" : "");
  if (S.mapReady) S.map.setPaintProperty("pts", "circle-color", S.admin ? statusMatch : typeMatch);
  render(); pushMap(); geocodeMissing();
  if (S.f.city) fitCity(S.f.city);
}

/* ---------------- geocoding (only for venues without coordinates) ---------------- */
const geoKey = v => [v.address, v.city, v.country].filter(Boolean).join(", ").toLowerCase();
let geoBusy = false;
async function geocodeMissing() {
  if (geoBusy) return; geoBusy = true;
  const geo = store.get("atlas-geo", {}); const todo = S.venues.filter(v => v._lat === null && (v.address || v.name));
  for (const v of todo) {
    const q = [v.address || v.name, v.city, v.country].filter(Boolean).join(", ");
    try {
      const r = await fetch("https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" + encodeURIComponent(q), { headers: { "Accept": "application/json" } });
      const j = await r.json();
      if (j[0]) { v._lat = +j[0].lat; v._lng = +j[0].lon; v._geoLocal = true; geo[geoKey(v)] = [v._lat, v._lng]; store.set("atlas-geo", geo); pushMap(); if (S.admin && C.SHEET_API && v.id) saveCoords(v); }
    } catch (_) {}
    await new Promise(r => setTimeout(r, 1100));
  }
  geoBusy = false; render();
}
async function post(body) {
  const r = await fetch(C.SHEET_API, { method: "POST", body: JSON.stringify({ ...body, key: S.key }) });
  return r.json();
}
function saveCoords(v) { post({ action: "setCoords", id: v.id, lat: v._lat, lng: v._lng }).catch(() => {}); }

/* ---------------- filtering ---------------- */
function inCap(v) { if (!S.f.cap) return true; const [a, b] = S.f.cap.split("-").map(Number); const c = num(v.cap); return c !== null && c >= a && c <= b; }
function visible() {
  const q = S.f.q.toLowerCase();
  return S.venues.filter(v =>
    (!S.present || !S.picked.size || S.picked.has(v._id)) &&
    (!S.f.city || v.city === S.f.city) &&
    (!S.f.types.size || S.f.types.has(v.type || "Other")) &&
    inCap(v) && (!S.f.io || v.io === S.f.io) &&
    (!S.f.late || /after|24h|late/i.test(v.late || "")) &&
    (!S.f.status || (v.status || "Scouting") === S.f.status) &&
    (!q || [v.name, v.area, v.type, v.genres, v.city, v.desc, S.admin ? v.operator : "", S.admin ? v.owner : ""].join(" ").toLowerCase().includes(q))
  ).sort((a, b) => (num(b.cap) || 0) - (num(a.cap) || 0));
}

/* ---------------- panel ---------------- */
function render() {
  const all = S.present && S.picked.size ? S.venues.filter(v => S.picked.has(v._id)) : S.venues;
  renderViews();
  const pool0 = S.view === "promoters" ? S.promoters : S.view === "media" ? S.media : all;
  const cityOf = x => x.city || x.City || "";
  const cities = [...new Set(pool0.map(cityOf).filter(Boolean))].sort();
  $("#cities").innerHTML = [`<button class="chip ${!S.f.city ? "on" : ""}" data-city=""><b>All</b> ${pool0.length}</button>`,
    ...cities.map(c => `<button class="chip ${S.f.city === c ? "on" : ""}" data-city="${esc(c)}"><b>${esc(c)}</b> ${pool0.filter(v => cityOf(v) === c).length}</button>`)].join("");
  if (S.view !== "venues") { renderScene(); return; }
  $(".filters").hidden = false;
  const pool = all.filter(v => !S.f.city || v.city === S.f.city);
  const types = [...new Set(pool.map(v => v.type || "Other"))].sort();
  $("#types").innerHTML = types.map(t => `<button class="chip ${S.f.types.has(t) ? "on" : ""}" data-type="${esc(t)}"><span class="dot" style="background:${TYPE_COLORS[t] || "#999"}"></span>${esc(t)}</button>`).join("");
  const vs = visible();
  const totalCap = vs.reduce((s, v) => s + (num(v.cap) || 0), 0);
  $("#stats").textContent = `${vs.length} venue${vs.length === 1 ? "" : "s"}${totalCap ? ` · ${totalCap.toLocaleString()} combined capacity` : ""}${S.picked.size && !S.present ? ` · ${S.picked.size} picked for sharing` : ""}`;
  $("#list").innerHTML = vs.length ? vs.map(v => `<div class="card ${S.sel === v._id ? "sel" : ""}" data-id="${esc(v._id)}">
      <span class="dot" style="background:${S.admin && v.status ? (STATUS_COLORS[v.status] || "#999") : (TYPE_COLORS[v.type] || "#999")}"></span>
      <div style="min-width:0;flex:1"><div class="nm">${esc(v.name)}</div><div class="mt">${esc([v.type, v.area].filter(Boolean).join(" · "))}${S.admin && v.status ? ` · ${esc(v.status)}` : ""}${v._lat === null ? " · locating…" : ""}</div></div>
      <div class="cap">${v.cap ? fmtN(v.cap) : "—"}<small>cap</small>${S.present ? "" : `<input type="checkbox" class="pick" data-pick="${esc(v._id)}" ${S.picked.has(v._id) ? "checked" : ""} title="Pick for a shared shortlist">`}</div></div>`).join("")
    : `<div class="empty">No venues match. Clear a filter or search another city.</div>`;
  renderLegend(vs);
}
function scenehere(v) {
  const ps = S.promoters.filter(p => p.City === v.city && venueMatches(p["Home venues"], v)); if (!ps.length) return "";
  return `<h3>Promoters & series here</h3>` + ps.map(p => `<div class="card" data-promo="${esc(p.Name)}"><span class="dot" style="background:${sceneColor(p.Type)}"></span><div><div class="nm">${esc(p.Name)}</div><div class="mt">${esc([p.Type, p.Genres].filter(Boolean).join(" · "))}</div></div></div>`).join("");
}
function renderLegend(vs) {
  const types = [...new Set(vs.map(v => v.type || "Other"))];
  $("#legend").innerHTML = S.admin ? Object.entries(STATUS_COLORS).map(([k, c]) => `<span><i class="dot" style="background:${c}"></i>${k}</span>`).join("") + (S.scout.length ? `<span><i class="dot" style="background:#5d5c64"></i>Scouted (OSM)</span>` : "")
    : types.map(t => `<span><i class="dot" style="background:${TYPE_COLORS[t] || "#999"}"></i>${esc(t)}</span>`).join("") + (S.scout.length ? `<span><i class="dot" style="background:#5d5c64"></i>Scouted (OSM)</span>` : "");
}

/* ---------------- scene: promoters & media ---------------- */
const SCENE_COLORS = { Promoter: "#c9a961", Collective: "#e06666", Festival: "#6aa84f", "Party series": "#c27ba0", "Venue operator": "#6fa8dc", "Venue promoter": "#6fa8dc", Label: "#8e7cc3" };
function sceneColor(t) { t = String(t || ""); for (const [k, c] of Object.entries(SCENE_COLORS)) if (t.includes(k)) return c; return "#8d8c94"; }
function renderViews() {
  const el = $("#views"); if (!el) return;
  const hasScene = S.promoters.length || S.media.length;
  el.hidden = S.present || !hasScene;
  el.innerHTML = [["venues", "Venues", S.venues.length], ["promoters", "Promoters", S.promoters.length], ["media", "Media & blogs", S.media.length]]
    .map(([k, l, n]) => `<button class="vt ${S.view === k ? "on" : ""}" data-view="${k}">${l} <small>${n}</small></button>`).join("");
}
function sceneList() {
  const q = S.f.q.toLowerCase(); const src = S.view === "promoters" ? S.promoters : S.media;
  return src.filter(x => (!S.f.city || x.City === S.f.city) && (!q || Object.values(x).join(" ").toLowerCase().includes(q)))
    .sort((a, b) => String(a.Status === "Check").localeCompare(String(b.Status === "Check")) || String(a.Name).localeCompare(String(b.Name)));
}
function renderScene() {
  $(".filters").hidden = true;
  const xs = sceneList(), P = S.view === "promoters";
  $("#stats").textContent = `${xs.length} ${P ? "promoters, collectives & series" : "media outlets, blogs & listings"}${S.f.city ? " in " + S.f.city : ""}`;
  $("#list").innerHTML = xs.length ? xs.map((x, i) => `<div class="card ${S.selScene === x ? "sel" : ""}" data-scene="${i}">
      <span class="dot" style="background:${P ? sceneColor(x.Type) : "#6fa8dc"}"></span>
      <div style="min-width:0;flex:1"><div class="nm">${esc(x.Name)}</div><div class="mt">${esc([x.Type, P ? x.Genres : x.Focus].filter(Boolean).join(" · "))}</div>
      ${P && x["Home venues"] ? `<div class="mt">@ ${esc(x["Home venues"])}</div>` : ""}</div>
      <div class="cap" style="font-size:12px;font-family:Inter">${P && x["Last event seen"] ? `<small>last seen</small>${esc(String(x["Last event seen"]).slice(0, 10))}` : ""}</div></div>`).join("")
    : `<div class="empty">Nothing here yet for this city.</div>`;
  S._sceneShown = xs;
  $("#legend").innerHTML = P ? Object.entries(SCENE_COLORS).filter(([k]) => !k.startsWith("Venue promoter")).map(([k, c]) => `<span><i class="dot" style="background:${c}"></i>${esc(k)}</span>`).join("") : "";
}
function openScene(x) {
  S.selScene = x; render(); const P = S.view === "promoters"; const d = $("#detail");
  const linked = P ? S.venues.filter(v => v.city === x.City && venueMatches(x["Home venues"], v)) : [];
  d.innerHTML = `<button class="ic x" id="closeD">Close</button>
    <span class="tag"><span class="dot" style="background:${P ? sceneColor(x.Type) : "#6fa8dc"};margin-right:6px"></span>${esc(x.Type || (P ? "Promoter" : "Media"))}</span>
    <h1>${esc(x.Name)}</h1><div class="sub">${esc([x.City, x.Country].filter(Boolean).join(" · "))}</div>
    ${x["Public description"] ? `<p class="desc">${esc(x["Public description"])}</p>` : x.Focus ? `<p class="desc">${esc(x.Focus)}</p>` : ""}
    <div class="links">${x.Website ? `<a class="btn" href="${esc(x.Website)}" target="_blank" rel="noopener">Website ↗</a>` : ""}${x.Instagram ? `<a class="btn" href="${esc(igUrl(x.Instagram))}" target="_blank" rel="noopener">Instagram ↗</a>` : ""}</div>
    <h3>Details</h3><div class="kv">
      ${kv("Genres", esc(x.Genres), true)}${kv("Home venues", esc(x["Home venues"]), true)}${kv("Event series", esc(x["Event series"]), true)}
      ${kv("Key people", esc(x["Key people"]), true)}${kv("Booking / contact", esc(x["Booking contact"] || x["Submit / contact"]), true)}
      ${kv("Last event seen", esc(x["Last event seen"]))}${kv("Status", esc(x.Status))}${kv("Verified", esc(x.Verified))}
      ${S.admin ? kv("Private notes", esc(x["Notes (private)"]), true) + kv("In my rolodex", esc(x["In my rolo"])) + kv("Sources", esc(x.Sources), true) : ""}
    </div>
    ${linked.length ? `<h3>Venues they use</h3>${linked.map(v => `<div class="card" data-goto="${esc(v._id)}"><span class="dot" style="background:${TYPE_COLORS[v.type] || "#999"}"></span><div><div class="nm">${esc(v.name)}</div><div class="mt">${esc([v.type, v.area].filter(Boolean).join(" · "))}</div></div></div>`).join("")}` : ""}`;
  d.hidden = false;
  $("#closeD").onclick = () => { d.hidden = true; S.selScene = null; render(); };
  d.querySelectorAll("[data-goto]").forEach(c => c.onclick = () => { S.view = "venues"; S.selScene = null; open(c.dataset.goto); });
}
function venueMatches(text, v) {
  text = String(text || "").toLowerCase(); if (!text || !v.name) return false;
  const nm = v.name.toLowerCase().replace(/\(.*?\)/g, "").replace(/\b(nightclub|club|atx|sd|la|sf|the)\b/g, "").replace(/\s+/g, " ").trim();
  return nm.length >= 3 && text.includes(nm) && (!v.city || true);
}

/* ---------------- detail ---------------- */
const kv = (label, val, wide) => (val === undefined || val === null || val === "") ? "" : `<div class="${wide ? "wide" : ""}"><label>${label}</label><span>${val}</span></div>`;
function gmaps(v) { return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent([v.name, v.address, v.city, v.country].filter(Boolean).join(", ")); }
function igUrl(h) { h = String(h || "").trim(); if (!h) return ""; if (/^https?:/.test(h)) return h; return "https://instagram.com/" + h.replace(/^@/, ""); }
function open(id, fly = true) {
  const v = S.venues.find(x => x._id === id); if (!v) return; S.sel = id; render();
  if (fly && v._lat !== null && S.map) S.map.flyTo({ center: [v._lng, v._lat], zoom: Math.max(S.map.getZoom(), 14.5), speed: 1.2 });
  if (S.map && S.mapReady) S.map.getSource("sel").setData(fc(v._lat !== null ? [v] : []));
  const d = $("#detail");
  const pub = `<div class="kv">
      ${kv("Capacity", v.cap ? `<span class="big">${fmtN(v.cap)}</span>` : "")}
      ${kv("Square feet", v.sqft ? `<span class="big">${fmtN(v.sqft)}</span>` : "")}
      ${kv("Indoor / outdoor", esc(v.io))}${kv("Curfew / license", esc(v.late))}
      ${kv("Alcohol", esc(v.alc))}${kv("Opened", esc(v.opened))}
      ${kv("Sound system", esc(v.sound), true)}${kv("Genres / vibe", esc(v.genres), true)}
    </div>`;
  const crit = v.crit ? Object.entries(v.crit).filter(([, r]) => r).map(([k, r]) => `<div><label>${esc(k)}</label><span>${"●".repeat(+r || 0)}${"○".repeat(Math.max(0, 5 - (+r || 0)))}</span></div>`).join("") : "";
  const priv = S.admin ? `<h3>Business intel · private</h3><div class="private"><div class="kv">
      ${kv("Status", v.status ? `<span class="tag" style="border-color:${STATUS_COLORS[v.status] || "#999"};color:${STATUS_COLORS[v.status] || "#999"}">${esc(v.status)}</span>` : "")}${kv("For", esc(v.use))}
      ${kv("Rent / month", v.rent ? `<span class="big">${money(v.rent)}</span>` : "")}${kv("Liquor sales / month", v.liq ? `<span class="big">${money(v.liq)}</span>` : "")}
      ${kv("Lease", esc(v.lease), true)}${kv("Rental / buyout fee", esc(money(v.fee)))}${kv("Deal", esc(v.deal))}
      ${kv("Owner", esc(v.owner))}${kv("Operator", esc(v.operator))}
      ${kv("Key contact", esc(v.contact) + (v.cphone ? `<br><a href="tel:${esc(v.cphone)}">${esc(v.cphone)}</a>` : "") + (v.cemail ? `<br><a href="mailto:${esc(v.cemail)}">${esc(v.cemail)}</a>` : ""), true)}
      ${kv("Last visit", esc(v.last))}${kv("Score", v.score ? `<span class="big">${esc(v.score)}</span><span class="meta"> / 100</span>` : "")}
      ${crit}${kv("Notes", esc(v.notes), true)}${kv("Sources", esc(v.sources), true)}${kv("Verified", esc(v.verified))}
    </div>
    ${(v.country || "").match(/^(usa|us|united states)/i) ? `<div style="margin-top:12px"><button class="btn gold" id="txBtn">Texas liquor receipts · official data</button><div id="txOut"></div></div>` : ""}
    </div>` : "";
  d.innerHTML = `<button class="ic x" id="closeD">Close</button>
    <span class="tag"><span class="dot" style="background:${TYPE_COLORS[v.type] || "#999"};margin-right:6px"></span>${esc(v.type || "Venue")}</span>
    <h1>${esc(v.name)}</h1>
    <div class="sub">${esc([v.address, v.area, v.city, v.country].filter(Boolean).join(" · "))}</div>
    ${v.desc ? `<p class="desc">${esc(v.desc)}</p>` : ""}
    <div class="links">${v.link ? `<a class="btn" href="${esc(v.link)}" target="_blank" rel="noopener">Website ↗</a>` : ""}${v.ig ? `<a class="btn" href="${esc(igUrl(v.ig))}" target="_blank" rel="noopener">Instagram ↗</a>` : ""}
      <a class="btn" href="${gmaps(v)}" target="_blank" rel="noopener">Google Maps ↗</a>
      ${S.present || !S.admin ? `<a class="btn gold" href="mailto:${esc(C.CONTACT_EMAIL || "")}?subject=${encodeURIComponent("Venue inquiry: " + v.name)}">Inquire</a>` : ""}</div>
    <h3>Specs</h3>${pub}${scenehere(v)}${priv}`;
  d.hidden = false;
  $("#closeD").onclick = () => { d.hidden = true; S.sel = null; render(); if (S.mapReady) S.map.getSource("sel").setData(fc([])); };
  const tb = $("#txBtn"); if (tb) tb.onclick = () => txLiquor(v);
  d.querySelectorAll("[data-promo]").forEach(c => c.onclick = () => { const p = S.promoters.find(x => x.Name === c.dataset.promo); if (p) { S.view = "promoters"; openScene(p); } });
}

/* ---------------- Texas liquor receipts (Texas Comptroller, public) ---------------- */
async function txLiquor(v) {
  const out = $("#txOut"); out.innerHTML = `<p class="meta">Looking up Texas Comptroller records…</p>`;
  const addr = String(v.address || "").toUpperCase().replace(/[.,#]/g, " ");
  const m = addr.match(/^(\d+)[A-Z]?\s+(?:(?:N|S|E|W|NORTH|SOUTH|EAST|WEST)\s+)?([A-Z0-9]+)/);
  if (!m) { out.innerHTML = `<p class="meta">Add a street address to look this up.</p>`; return; }
  const city = String(v.city || "").toUpperCase().replace(/'/g, "");
  const where = `upper(location_address) like '${m[1]}%${m[2]}%'` + (city ? ` AND location_city='${city}'` : "");
  const url = "https://data.texas.gov/resource/naix-2893.json?$limit=120&$order=obligation_end_date_yyyymmdd DESC&$where=" + encodeURIComponent(where);
  try {
    const rows = await (await fetch(url)).json();
    if (!Array.isArray(rows) || !rows.length) { out.innerHTML = `<p class="meta">No Texas mixed-beverage record found at this address. It may be outside Texas, BYOB, or filed under a different address.</p>`; return; }
    const by = {}; rows.forEach(r => { const k = r.location_name + "|" + r.tabc_permit_number; (by[k] = by[k] || []).push(r); });
    out.innerHTML = Object.values(by).slice(0, 3).map(list => {
      const last12 = list.slice(0, 12); const avg = Math.round(last12.reduce((s, r) => s + (+r.total_receipts || 0), 0) / last12.length);
      const mx = Math.max(...last12.map(r => +r.total_receipts || 0), 1); const f = list[0];
      const since = (f.responsibility_begin_date_yyyymmdd || "").slice(0, 10);
      return `<div class="private" style="margin-top:10px"><b>${esc(f.location_name)}</b> <span class="meta">permit ${esc(f.tabc_permit_number)}</span>
        <div class="kv" style="margin-top:8px">${kv("Avg / month (last " + last12.length + ")", `<span class="big">$${avg.toLocaleString()}</span>`)}${kv("Latest month", `$${(+f.total_receipts || 0).toLocaleString()}<br><span class="meta">${esc((f.obligation_end_date_yyyymmdd || "").slice(0, 7))}</span>`)}
        ${kv("Operating entity", esc(f.taxpayer_name), true)}${kv("Permit holder since", esc(since))}${kv("Cover charges (latest)", "$" + (+f.cover_charge_receipts || 0).toLocaleString())}</div>
        <div class="bars" title="Monthly gross receipts, oldest → newest">${last12.slice().reverse().map(r => `<i style="height:${Math.max(2, (+r.total_receipts || 0) / mx * 100)}%" title="${esc((r.obligation_end_date_yyyymmdd || "").slice(0, 7))}: $${(+r.total_receipts || 0).toLocaleString()}"></i>`).join("")}</div>
        <p class="meta" style="margin:6px 0 0">Liquor + beer + wine + cover receipts reported to the Texas Comptroller.${C.SHEET_API ? ` <button class="btn sm" data-saveliq="${avg}">Save $${avg.toLocaleString()} as liquor sales / mo</button>` : ""}</p></div>`;
    }).join("");
    out.querySelectorAll("[data-saveliq]").forEach(b => b.onclick = async () => { b.disabled = true; try { await post({ action: "setField", id: v.id, header: "Liquor sales $/mo", value: b.dataset.saveliq }); v.liq = b.dataset.saveliq; toast("Saved to your sheet."); } catch (_) { toast("Couldn't save — check the sheet bridge."); } });
  } catch (e) { out.innerHTML = `<p class="meta">Couldn't reach data.texas.gov right now.</p>`; }
}

/* ---------------- map ---------------- */
function fc(list) { return { type: "FeatureCollection", features: list.filter(v => v._lat !== null && v._lng !== null).map(v => ({ type: "Feature", geometry: { type: "Point", coordinates: [v._lng, v._lat] }, properties: { id: v._id, name: v.name, type: v.type || "Other", cap: num(v.cap) || 0, status: v.status || "Scouting" } })) }; }
function pushMap() { if (S.mapReady) S.map.getSource("venues").setData(fc(visible())); }
async function darkStyle() {
  const s = await (await fetch(C.STYLE_URL || "https://tiles.openfreemap.org/styles/positron")).json();
  (s.layers || []).forEach(l => {
    const p = l.paint = l.paint || {}; const id = l.id || "";
    if (l.type === "background") p["background-color"] = "#0a0a0c";
    else if (l.type === "fill") { p["fill-color"] = /water/.test(id) ? "#0c131c" : /park|green|wood|grass|landcover|landuse/.test(id) ? "#0f1411" : /building/.test(id) ? "#17171b" : "#111114"; if ("fill-outline-color" in p) p["fill-outline-color"] = "#1c1c21"; }
    else if (l.type === "line") p["line-color"] = /water|river|waterway/.test(id) ? "#0c131c" : /boundary|admin/.test(id) ? "#3a3a42" : /motorway|trunk|primary|major/.test(id) ? "#38332c" : "#232328";
    else if (l.type === "symbol") { p["text-color"] = /place|city|town|capital/.test(id) ? "#b9b6ad" : "#77757d"; p["text-halo-color"] = "#0a0a0c"; p["text-halo-width"] = 1.2; if (l.layout && l.layout["icon-image"]) p["icon-opacity"] = 0.5; }
    else if (l.type === "fill-extrusion") p["fill-extrusion-color"] = "#18181c";
  });
  return s;
}
const typeMatch = ["match", ["get", "type"], ...Object.entries(TYPE_COLORS).flat(), "#999999"];
const statusMatch = ["match", ["get", "status"], ...Object.entries(STATUS_COLORS).flat(), "#8d8c94"];
async function initMap() {
  if (!window.maplibregl) { toast("Map library didn't load — check your connection."); return; }
  let style; try { style = await darkStyle(); } catch (e) { toast("Map tiles unavailable right now — the list still works."); return; }
  const map = S.map = new maplibregl.Map({ container: "map", style, center: C.CENTER || [-97.7431, 30.2672], zoom: C.ZOOM || 11.8, attributionControl: { compact: true } });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
  map.on("load", () => {
    map.addSource("venues", { type: "geojson", data: fc([]), cluster: true, clusterRadius: 38, clusterMaxZoom: 11 });
    map.addSource("sel", { type: "geojson", data: fc([]) });
    map.addSource("scout", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({ id: "scout", type: "circle", source: "scout", paint: { "circle-radius": 5, "circle-color": "#5d5c64", "circle-stroke-color": "#0a0a0c", "circle-stroke-width": 1 } });
    map.addLayer({ id: "clusters", type: "circle", source: "venues", filter: ["has", "point_count"], paint: { "circle-color": "rgba(201,169,97,.18)", "circle-stroke-color": "#c9a961", "circle-stroke-width": 1.2, "circle-radius": ["step", ["get", "point_count"], 16, 10, 22, 30, 28] } });
    map.addLayer({ id: "cluster-n", type: "symbol", source: "venues", filter: ["has", "point_count"], layout: { "text-field": ["get", "point_count_abbreviated"], "text-font": ["Noto Sans Regular"], "text-size": 12 }, paint: { "text-color": "#ecebe6" } });
    map.addLayer({ id: "pts", type: "circle", source: "venues", filter: ["!", ["has", "point_count"]], paint: {
      "circle-radius": ["interpolate", ["linear"], ["get", "cap"], 0, 6, 300, 7, 1000, 10, 3000, 14, 10000, 18, 30000, 22],
      "circle-color": S.admin ? statusMatch : typeMatch, "circle-opacity": .9, "circle-stroke-color": "#0a0a0c", "circle-stroke-width": 1.5 } });
    map.addLayer({ id: "sel", type: "circle", source: "sel", paint: { "circle-radius": 14, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#ecebe6", "circle-stroke-width": 2 } });
    map.addLayer({ id: "labels", type: "symbol", source: "venues", minzoom: 12.5, filter: ["!", ["has", "point_count"]], layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Regular"], "text-size": 12, "text-offset": [0, 1.4], "text-anchor": "top", "text-optional": true }, paint: { "text-color": "#ecebe6", "text-halo-color": "#0a0a0c", "text-halo-width": 1.4 } });
    S.mapReady = true; pushMap();
    map.on("click", "pts", e => open(e.features[0].properties.id, false));
    map.on("click", "clusters", e => { const f = e.features[0]; map.getSource("venues").getClusterExpansionZoom(f.properties.cluster_id).then(z => map.easeTo({ center: f.geometry.coordinates, zoom: z + .5 })).catch(() => map.easeTo({ center: f.geometry.coordinates, zoom: map.getZoom() + 2 })); });
    map.on("click", "scout", e => scoutPopup(e.features[0], e.lngLat));
    ["pts", "clusters", "scout"].forEach(l => { map.on("mouseenter", l, () => map.getCanvas().style.cursor = "pointer"); map.on("mouseleave", l, () => map.getCanvas().style.cursor = ""); });
    if (S.f.city) fitCity(S.f.city);
  });
}
function fitCity(city) {
  if (!S.mapReady) return; const vs = S.venues.filter(v => v.city === city && v._lat !== null); if (!vs.length) return;
  if (vs.length === 1) { S.map.flyTo({ center: [vs[0]._lng, vs[0]._lat], zoom: 14 }); return; }
  const b = new maplibregl.LngLatBounds(); vs.forEach(v => b.extend([v._lng, v._lat])); S.map.fitBounds(b, { padding: 60, maxZoom: 14 });
}

/* ---------------- search anywhere ---------------- */
async function goPlace(q) {
  try { const j = await (await fetch("https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" + encodeURIComponent(q))).json();
    if (!j[0]) { toast(`Couldn't find “${q}”.`); return; }
    const bb = j[0].boundingbox.map(Number);
    S.map.fitBounds([[bb[2], bb[0]], [bb[3], bb[1]]], { padding: 30, maxZoom: 13 });
    toast(S.admin ? `Moved to ${j[0].display_name.split(",")[0]}. Tap ✦ Scout this area to find venues here.` : `Moved to ${j[0].display_name.split(",")[0]}.`);
  } catch (_) { toast("Search is unavailable right now."); }
}

/* ---------------- scout (OpenStreetMap, worldwide) ---------------- */
async function scout() {
  if (!S.mapReady) return; if (S.map.getZoom() < 11) { toast("Zoom in to a city first, then scout."); return; }
  const b = S.map.getBounds(); const bbox = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()].map(n => n.toFixed(4)).join(",");
  const q = `[out:json][timeout:25];(nwr["amenity"~"^(nightclub|music_venue|events_venue|theatre|arts_centre|stripclub)$"](${bbox});nwr["leisure"="dance"](${bbox}););out center tags 400;`;
  $("#scoutBtn").textContent = "Scouting…";
  try {
    const j = await (await fetch("https://overpass-api.de/api/interpreter", { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "Content-Type": "application/x-www-form-urlencoded" } })).json();
    const have = new Set(S.venues.map(v => normName(v.name)));
    S.scout = (j.elements || []).map(e => ({ id: "osm-" + e.type + "-" + e.id, name: e.tags && e.tags.name, lat: e.lat ?? (e.center && e.center.lat), lng: e.lon ?? (e.center && e.center.lon), tags: e.tags || {} }))
      .filter(x => x.name && x.lat && x.tags.amenity !== "stripclub" && !have.has(normName(x.name)));
    S.map.getSource("scout").setData({ type: "FeatureCollection", features: S.scout.map(s => ({ type: "Feature", geometry: { type: "Point", coordinates: [s.lng, s.lat] }, properties: { id: s.id } })) });
    toast(S.scout.length ? `${S.scout.length} venue${S.scout.length === 1 ? "" : "s"} found here that aren't in your Atlas yet (grey pins).` : "No new venues found in this view.");
    renderLegend(visible());
  } catch (e) { toast("Scouting service is busy — try again in a moment."); }
  $("#scoutBtn").textContent = "✦ Scout this area";
}
function scoutPopup(f, lngLat) {
  const s = S.scout.find(x => x.id === f.properties.id); if (!s) return; const t = s.tags;
  const addr = [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ");
  const type = { nightclub: "Club", music_venue: "Concert venue", events_venue: "Event space", theatre: "Theater", arts_centre: "Gallery / Art space" }[t.amenity] || (t.leisure === "dance" ? "Club" : "Other");
  const html = `<b>${esc(s.name)}</b><div class="meta">${esc(type)}${addr ? " · " + esc(addr) : ""}</div>
    ${t.capacity ? `<div>Capacity ${esc(t.capacity)}</div>` : ""}${t.opening_hours ? `<div class="meta">${esc(t.opening_hours)}</div>` : ""}
    <div class="links" style="margin-top:8px">${t.website ? `<a class="btn sm" href="${esc(t.website)}" target="_blank" rel="noopener">Website ↗</a>` : ""}
    <a class="btn sm" href="${gmaps({ name: s.name, address: addr, city: t["addr:city"] || "" })}" target="_blank" rel="noopener">Maps ↗</a>
    <button class="btn sm gold" id="addScout">+ Add to Atlas</button></div>`;
  const pop = new maplibregl.Popup({ maxWidth: "280px" }).setLngLat(lngLat).setHTML(html).addTo(S.map);
  setTimeout(() => { const btn = document.getElementById("addScout"); if (btn) btn.onclick = async () => {
    const row = { "Name": s.name, "City": t["addr:city"] || S.f.city || "", "Country": t["addr:country"] || "", "Address": addr, "Lat": s.lat, "Lng": s.lng, "Type": type, "Status": "Scouting", "Capacity": t.capacity || "", "Website": t.website || "", "Sources": "OpenStreetMap " + s.id, "Verified": new Date().toISOString().slice(0, 7) };
    if (C.SHEET_API && S.admin) { btn.disabled = true; try { const r = await post({ action: "add", venue: row }); if (r.ok) { toast(`${s.name} added to your sheet. It'll appear in World on the next sync.`); pop.remove(); S.scout = S.scout.filter(x => x.id !== s.id); load(); } else toast(r.error || "Couldn't add."); } catch (_) { toast("Couldn't reach your sheet."); btn.disabled = false; } }
    else { try { await navigator.clipboard.writeText(Object.values(row).join("\t")); toast("Copied as a sheet row. Paste it into your venues tab."); } catch (_) { toast("Connect your sheet to add venues in one tap."); } }
  }; }, 0);
}

/* ---------------- share / present ---------------- */
function share() {
  const base = location.origin + location.pathname;
  const cityUrl = base + "?present=1" + (S.f.city ? "&city=" + encodeURIComponent(S.f.city) : "");
  const pickUrl = S.picked.size ? base + "?present=1&ids=" + [...S.picked].map(encodeURIComponent).join(",") + (S.f.city ? "&city=" + encodeURIComponent(S.f.city) : "") : "";
  modal(`<h2>Share with a client</h2>
    <p class="meta">Client links never include private intel (rent, liquor sales, owners, contacts, notes). Venues with an <b>Inquire</b> button email you.</p>
    <label class="meta">${S.f.city ? esc(S.f.city) + " — all venues" : "All venues"}</label><input type="text" readonly value="${esc(cityUrl)}">
    ${pickUrl ? `<label class="meta">Your shortlist (${S.picked.size} picked)</label><input type="text" readonly value="${esc(pickUrl)}">` : `<p class="meta">Tip: tick the box on any venue card to build a shortlist link.</p>`}
    <div class="row"><button class="btn" data-close>Close</button><button class="btn gold" id="copyShare">Copy ${pickUrl ? "shortlist" : "link"}</button></div>`);
  $("#copyShare").onclick = async () => { try { await navigator.clipboard.writeText(pickUrl || cityUrl); toast("Link copied."); } catch (_) { toast("Select the link and copy it."); } };
}
function owner() {
  if (S.admin) { modal(`<h2>Owner view</h2><p class="meta">You're signed in on this device.</p><div class="row"><button class="btn" data-close>Close</button><button class="btn gold" id="signOut">Sign out</button></div>`); $("#signOut").onclick = () => { S.key = ""; store.set("atlas-key", ""); closeModal(); load(); }; return; }
  modal(`<h2>Owner sign-in</h2><p class="meta">${C.SHEET_API ? "Enter your owner key to see private intel and scouting tools on this device." : "Connect your Google Sheet first (README step 2). Then your owner key unlocks private intel."}</p>
    <input type="password" id="keyIn" placeholder="Owner key" autocomplete="current-password"><div class="row"><button class="btn" data-close>Cancel</button><button class="btn gold" id="keyGo">Sign in</button></div>`);
  setTimeout(() => $("#keyIn").focus(), 30);
  const go = () => { S.key = $("#keyIn").value.trim(); store.set("atlas-key", S.key); closeModal(); load(); };
  $("#keyGo").onclick = go; $("#keyIn").onkeydown = e => { if (e.key === "Enter") go(); };
}
function modal(html) { $("#mbox").innerHTML = html; $("#modal").hidden = false; }
function closeModal() { $("#modal").hidden = true; }
function csv() {
  const vs = visible(); const keys = Object.keys(KEYHEAD).filter(k => k !== "id" && k !== "score");
  const q = s => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const text = [keys.map(k => q(KEYHEAD[k])).join(","), ...vs.map(v => keys.map(k => q(k === "lat" ? v._lat ?? "" : k === "lng" ? v._lng ?? "" : v[k])).join(","))].join("\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" })); a.download = `atlas-${(S.f.city || "all").toLowerCase()}.csv`; a.click();
}

/* ---------------- wiring ---------------- */
function wire() {
  $("#brand").textContent = C.BRAND || "ZENTE ATLAS"; $("#tagline").textContent = C.TAGLINE || "Venues & spaces"; document.title = (C.BRAND || "ZENTE ATLAS") + " — Venues & Spaces";
  if (S.present) { $("#ownerBtn").hidden = true; $("#shareBtn").hidden = true; const n = $("#presentNote"); n.hidden = false; n.innerHTML = `A curated selection${S.f.city ? " in " + esc(S.f.city) : ""}. Tap a venue for details${C.CONTACT_EMAIL ? `, or <a href="mailto:${esc(C.CONTACT_EMAIL)}">get in touch</a>` : ""}.`; }
  $("#cities").onclick = e => { const b = e.target.closest("[data-city]"); if (!b) return; S.f.city = b.dataset.city; S.f.types.clear(); render(); pushMap(); if (S.f.city) fitCity(S.f.city); };
  $("#types").onclick = e => { const b = e.target.closest("[data-type]"); if (!b) return; const t = b.dataset.type; S.f.types.has(t) ? S.f.types.delete(t) : S.f.types.add(t); render(); pushMap(); };
  $("#cap").onchange = e => { S.f.cap = e.target.value; render(); pushMap(); };
  $("#io").onchange = e => { S.f.io = e.target.value; render(); pushMap(); };
  $("#late").onchange = e => { S.f.late = e.target.checked; render(); pushMap(); };
  $("#status").onchange = e => { S.f.status = e.target.value; render(); pushMap(); };
  $("#q").oninput = e => { S.f.q = e.target.value; render(); pushMap(); };
  $("#q").onkeydown = e => { if (e.key === "Enter" && S.f.q.trim() && !visible().length) { const q = S.f.q.trim(); S.f.q = ""; e.target.value = ""; render(); pushMap(); goPlace(q); } };
  $("#views").onclick = e => { const b = e.target.closest("[data-view]"); if (!b) return; S.view = b.dataset.view; S.selScene = null; $("#detail").hidden = true; render(); };
  $("#list").onclick = e => { const sc = e.target.closest("[data-scene]"); if (sc) { const x = (S._sceneShown || [])[+sc.dataset.scene]; if (x) openScene(x); return; } const p = e.target.closest("[data-pick]"); if (p) { e.stopPropagation(); p.checked ? S.picked.add(p.dataset.pick) : S.picked.delete(p.dataset.pick); render(); return; } const c = e.target.closest("[data-id]"); if (c) open(c.dataset.id); };
  $("#shareBtn").onclick = share; $("#ownerBtn").onclick = owner; $("#scoutBtn").onclick = scout; $("#csvBtn").onclick = csv;
  $("#modal").onclick = e => { if (e.target.id === "modal" || e.target.closest("[data-close]")) closeModal(); };
  document.addEventListener("keydown", e => { if (e.key === "Escape") { closeModal(); $("#detail").hidden = true; } });
}
wire(); initMap(); load();
window.__atlas = S;
})();
