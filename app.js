/* Dokumentenarchiv – iPhone-Version, läuft komplett ohne Server. */
"use strict";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDate = s => { if (!s) return ""; const [y, m, d] = s.split("-"); return `${d}.${m}.${y}`; };
const fmtEur = v => v == null || v === "" ? "" : Number(v).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const todayIso = () => Analyse.iso(new Date());
const daysUntil = s => Math.round((new Date(s + "T00:00:00") - new Date(todayIso() + "T00:00:00")) / 86400000);
const base = new URL(".", location.href).href;

const S = { topics: [], docs: [], model: null, scan: { pages: [], mode: "grau" }, ocr: null, lastQ: "" };

// ------------------------------------------------------------ Start
async function init() {
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) { }
  S.topics = await DB.kvGet("topics", null);
  if (!S.topics) { S.topics = Analyse.DEFAULT_TOPICS; await DB.kvSet("topics", S.topics); }
  S.scan.mode = await DB.kvGet("scanmode", "grau");
  await reload();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => { });
  window.addEventListener("hashchange", route);
  document.addEventListener("visibilitychange", onVisibility);
  bindInputs();
  if (await DB.kvGet("pin", null)) await lockScreen(); else route();
}

async function reload() {
  S.docs = (await DB.all()).sort((a, b) => (b.date || b.created || "").localeCompare(a.date || a.created || ""));
  S.model = null;
  updateBadge();
}
function model() {
  if (!S.model) S.model = new Analyse.Model(S.docs.filter(d => d.confirmed && d.text).map(d => [d.topic, d.text.slice(0, 4000)]));
  return S.model;
}
const topicOf = name => S.topics.find(t => t.name === name) || { name, icon: "📁", color: "#adb5bd" };

function route() {
  const h = decodeURIComponent(location.hash.slice(1) || "/");
  window.scrollTo(0, 0);
  $("#fab").style.display = /^\/(dok|scan|einstellungen|themen)/.test(h) ? "none" : "";
  let m;
  if (h === "/" || h === "") return viewHome();
  if ((m = h.match(/^\/thema\/(.+)$/))) return viewTopic(m[1]);
  if ((m = h.match(/^\/dok\/(\d+)$/))) return viewDoc(+m[1]);
  if (h === "/scan") return viewScan();
  if (h === "/pruefen") return viewList("Zu prüfen", S.docs.filter(d => !d.confirmed), "Alles geprüft 👍");
  if (h === "/fristen") return viewDeadlines();
  if (h === "/einstellungen") return viewSettings();
  if (h === "/themen") return viewTopicsEdit();
  if (h === "/alle") return viewList("Alle Dokumente", S.docs, "Noch keine Dokumente.");
  viewHome();
}
const go = h => { if (location.hash === "#" + h) route(); else location.hash = h; };

function header(title, back) {
  $("#title").textContent = title;
  $("#back").style.visibility = back ? "visible" : "hidden";
}

// ------------------------------------------------------------ Übersicht
function deadlineItems() {
  const items = [];
  for (const d of S.docs) {
    if (d.paid === false) items.push({ d, date: d.dueDate || "", art: d.doctype === "Mahnung" ? "Mahnung offen" : "Rechnung offen" });
    if (d.cancelBy && daysUntil(d.cancelBy) >= -1) items.push({ d, date: d.cancelBy, art: "Kündigen bis" });
    if (d.warrantyUntil && daysUntil(d.warrantyUntil) >= 0 && daysUntil(d.warrantyUntil) <= 90) items.push({ d, date: d.warrantyUntil, art: "Garantie endet" });
    if (d.contractEnd && !d.cancelBy && daysUntil(d.contractEnd) >= 0 && daysUntil(d.contractEnd) <= 120) items.push({ d, date: d.contractEnd, art: "Vertrag endet" });
  }
  return items.sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999"));
}

async function viewHome() {
  header("Archiv", false);
  const open = S.docs.filter(d => !d.confirmed).length;
  const dl = deadlineItems(); const urgent = dl.filter(x => !x.date || daysUntil(x.date) <= 14).length;
  const counts = {}; S.docs.forEach(d => counts[d.topic] = (counts[d.topic] || 0) + 1);
  const last = await DB.kvGet("lastBackup", null);
  const needBackup = S.docs.length >= 3 && (!last || (Date.now() - last) > 30 * 86400000);
  $("#view").innerHTML = `
    <div class="search"><input id="q" type="search" placeholder="🔍  Suchen – Text, Absender, Betrag …" value="${esc(S.lastQ)}" autocomplete="off"></div>
    <div id="results"></div>
    <div id="home">
      ${needBackup ? `<div class="banner" onclick="go('/einstellungen')">💾 <b>Sicherung empfohlen</b> – ${last ? "letzte vor über 30 Tagen" : "noch keine Sicherung"}. Tippen zum Sichern in iCloud.</div>` : ""}
      <div class="chips">
        <button class="chip ${open ? "warn" : ""}" onclick="go('/pruefen')"><b>${open}</b> zu prüfen</button>
        <button class="chip ${urgent ? "warn" : ""}" onclick="go('/fristen')"><b>${dl.length}</b> Fristen &amp; offen</button>
        <button class="chip" onclick="go('/alle')"><b>${S.docs.length}</b> Dokumente</button>
      </div>
      <h2>Themen</h2>
      <div class="topics">${S.topics.map(t => `<button class="topic" style="--c:${t.color}" onclick="go('/thema/${encodeURIComponent(t.name)}')">
        <span class="ti">${t.icon}</span><span class="tn">${esc(t.name)}</span><span class="tc">${counts[t.name] || 0}</span></button>`).join("")}</div>
      <h2>Zuletzt hinzugefügt</h2>
      ${list([...S.docs].sort((a, b) => (b.created || "").localeCompare(a.created || "")).slice(0, 8), "Noch leer – tippe unten auf ＋ und fotografiere dein erstes Dokument.")}
    </div>`;
  const q = $("#q");
  q.addEventListener("input", () => { S.lastQ = q.value; doSearch(); });
  if (S.lastQ) doSearch();
}

function doSearch() {
  const q = S.lastQ.trim().toLowerCase();
  $("#home").style.display = q ? "none" : "";
  if (!q) { $("#results").innerHTML = ""; return; }
  const words = q.split(/\s+/).filter(Boolean);
  const hits = [];
  for (const d of S.docs) {
    const meta = `${d.title} ${d.sender} ${d.topic} ${d.doctype} ${d.tags} ${d.note} ${d.original} ${d.amount != null ? String(d.amount).replace(".", ",") : ""} ${fmtDate(d.date)}`.toLowerCase();
    const text = (d.text || "").toLowerCase();
    let score = 0, ok = true;
    for (const w of words) {
      const inM = meta.includes(w), inT = text.includes(w);
      if (!inM && !inT) { ok = false; break; }
      score += inM ? 3 : 1;
    }
    if (ok) {
      let snip = "";
      const i = text.indexOf(words[0]);
      if (i >= 0) snip = (i > 30 ? "…" : "") + d.text.slice(Math.max(0, i - 30), i + 70).replace(/\s+/g, " ") + "…";
      hits.push({ d, score, snip });
    }
  }
  hits.sort((a, b) => b.score - a.score);
  $("#results").innerHTML = `<p class="small">${hits.length} Treffer</p>` + list(hits.map(h => h.d), "Nichts gefunden.", Object.fromEntries(hits.map(h => [h.d.id, h.snip])));
}

function list(docs, empty, snips) {
  if (!docs.length) return `<p class="empty">${empty}</p>`;
  return `<div class="list">${docs.map(d => {
    const t = topicOf(d.topic);
    return `<a class="item" href="#/dok/${d.id}">
      <div class="thumb">${d.thumb ? `<img src="${d.thumb}" alt="">` : `<span>${d.kind === "pdf" ? "📄" : "📎"}</span>`}</div>
      <div class="meta"><div class="it">${esc(d.title || "Dokument")}${d.confirmed ? "" : ` <span class="dot" title="zu prüfen"></span>`}</div>
        <div class="is"><span style="color:${t.color}">${t.icon} ${esc(d.topic)}</span>${d.date ? " · " + fmtDate(d.date) : ""}${d.amount != null ? " · " + fmtEur(d.amount) : ""}${d.paid === false ? ` · <b class="red">offen</b>` : ""}</div>
        ${snips && snips[d.id] ? `<div class="snip">${esc(snips[d.id])}</div>` : ""}</div></a>`;
  }).join("")}</div>`;
}

function viewTopic(name) {
  const t = topicOf(name);
  header(`${t.icon} ${name}`, true);
  const docs = S.docs.filter(d => d.topic === name);
  const years = {};
  docs.forEach(d => { const y = (d.date || d.created || "").slice(0, 4) || "ohne Datum"; (years[y] = years[y] || []).push(d); });
  $("#view").innerHTML = docs.length ? Object.keys(years).sort().reverse().map(y => `<h2>${y}</h2>${list(years[y])}`).join("")
    : `<p class="empty">In diesem Thema liegt noch nichts.</p>`;
}

function viewList(title, docs, empty) { header(title, true); $("#view").innerHTML = list(docs, empty); }

function viewDeadlines() {
  header("Fristen & Offenes", true);
  const items = deadlineItems();
  $("#view").innerHTML = items.length ? `<div class="list">${items.map(x => {
    const n = x.date ? daysUntil(x.date) : null;
    const when = n == null ? "ohne Datum" : n < 0 ? `seit ${-n} Tag${n === -1 ? "" : "en"} fällig` : n === 0 ? "heute" : `in ${n} Tag${n === 1 ? "" : "en"}`;
    return `<div class="item">
      <a class="meta" href="#/dok/${x.d.id}"><div class="it">${esc(x.art)}: ${esc(x.d.title)}</div>
      <div class="is ${n != null && n <= 3 ? "red" : ""}">${x.date ? fmtDate(x.date) + " · " : ""}${when}${x.d.amount != null ? " · " + fmtEur(x.d.amount) : ""}</div></a>
      ${x.art.includes("offen") ? `<button class="mini" onclick="markPaid(${x.d.id})">✓ bezahlt</button>` : ""}</div>`;
  }).join("")}</div>` : `<p class="empty">Keine offenen Rechnungen oder Fristen. 🎉</p>`;
}
async function markPaid(id) { const d = await DB.get(id); d.paid = true; await DB.put(d); await reload(); route(); toast("Als bezahlt markiert"); }

// ------------------------------------------------------------ Dokument
async function viewDoc(id) {
  const d = await DB.get(id);
  if (!d) return go("/");
  const t = topicOf(d.topic);
  header(d.title || "Dokument", true);
  const opt = S.topics.map(x => `<option ${x.name === d.topic ? "selected" : ""}>${esc(x.name)}</option>`).join("");
  $("#view").innerHTML = `
    ${d.confirmed ? "" : `<div class="banner check">✨ Automatisch erkannt: <b>${t.icon} ${esc(d.topic)}</b>. Stimmt das? Sonst unten ändern.
      <button class="btn small" onclick="confirmDoc(${id})">Passt so ✓</button></div>`}
    <div id="pages" class="pages-view"><p class="small">Wird geladen …</p></div>
    <div class="actions">
      <button class="btn sec" onclick="shareDoc(${id})">📤 Teilen / Sichern</button>
      <button class="btn sec" onclick="addPagesTo(${id})" ${d.kind === "scan" ? "" : "style='display:none'"}>📷 Seite dazu</button>
    </div>
    <form class="card" id="f">
      <label>Titel</label><input class="f" name="title" value="${esc(d.title)}">
      <label>Thema</label><select class="f" name="topic">${opt}</select>
      <div class="row"><div><label>Datum</label><input class="f" type="date" name="date" value="${esc(d.date || "")}"></div>
        <div><label>Betrag (€)</label><input class="f" name="amount" inputmode="decimal" value="${d.amount != null ? Number(d.amount).toFixed(2).replace(".", ",") : ""}"></div></div>
      <div class="row"><div><label>Absender</label><input class="f" name="sender" value="${esc(d.sender)}"></div>
        <div><label>Art</label><input class="f" name="doctype" value="${esc(d.doctype)}"></div></div>
      <label>Schlagworte</label><input class="f" name="tags" value="${esc(d.tags)}" placeholder="z. B. auto, steuer 2026">
      <details ${d.dueDate || d.paid != null || d.cancelBy || d.warrantyUntil ? "open" : ""}><summary>Fristen &amp; Zahlung</summary>
        <div class="row"><div><label>Zahlbar bis</label><input class="f" type="date" name="dueDate" value="${esc(d.dueDate || "")}"></div>
          <div><label>Bezahlt?</label><select class="f" name="paid"><option value="">–</option><option value="0" ${d.paid === false ? "selected" : ""}>offen</option><option value="1" ${d.paid === true ? "selected" : ""}>bezahlt</option></select></div></div>
        <div class="row"><div><label>Kündigen bis</label><input class="f" type="date" name="cancelBy" value="${esc(d.cancelBy || "")}"></div>
          <div><label>Garantie bis</label><input class="f" type="date" name="warrantyUntil" value="${esc(d.warrantyUntil || "")}"></div></div>
        ${d.iban ? `<p class="small">IBAN im Dokument: <b>${esc(d.iban.replace(/(.{4})/g, "$1 ").trim())}</b> <button type="button" class="mini" onclick="copyText('${esc(d.iban)}')">kopieren</button></p>` : ""}
      </details>
      <label>Papier-Original liegt in</label><input class="f" name="original" value="${esc(d.original || "")}" placeholder="z. B. Ordner Versicherungen">
      <label>Notiz</label><textarea class="f" name="note" rows="2">${esc(d.note || "")}</textarea>
      <button class="btn" type="submit">Speichern</button>
    </form>
    <details class="card"><summary>Erkannter Text</summary><pre class="ocr">${esc(d.text || "(kein Text erkannt)")}</pre></details>
    <p class="small center">Hinzugefügt am ${esc(new Date(d.created).toLocaleString("de-DE"))}${d.fileName ? " · " + esc(d.fileName) : ""}</p>
    <button class="btn danger" onclick="deleteDoc(${id})">🗑 Dokument löschen</button>`;
  $("#f").addEventListener("submit", async e => { e.preventDefault(); await saveForm(id, new FormData(e.target)); });
  renderPages(d);
}

async function renderPages(d) {
  const box = $("#pages"); box.innerHTML = "";
  if (d.kind === "pdf") {
    const blob = await DB.getFile(d.id, 0);
    if (!blob) { box.innerHTML = `<p class="small">Datei fehlt.</p>`; return; }
    try {
      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
      for (let i = 1; i <= Math.min(pdf.numPages, 40); i++) {
        const page = await pdf.getPage(i); const vp0 = page.getViewport({ scale: 1 });
        const sc = Math.min(2.5, (box.clientWidth || 360) * 2 / vp0.width); const vp = page.getViewport({ scale: sc });
        const c = document.createElement("canvas"); c.width = vp.width; c.height = vp.height; c.className = "pg";
        box.appendChild(c);
        await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
        if (!$("#pages")) return;
      }
      if (pdf.numPages > 40) box.insertAdjacentHTML("beforeend", `<p class="small">… weitere ${pdf.numPages - 40} Seiten über „Teilen“ ansehen</p>`);
    } catch (e) { box.innerHTML = `<p class="small">PDF kann nicht angezeigt werden – über „Teilen“ öffnen.</p>`; }
    return;
  }
  if (d.kind === "datei") { box.innerHTML = `<div class="filebox">📎 ${esc(d.fileName || "Datei")}<br><span class="small">Über „Teilen“ öffnen</span></div>`; return; }
  for (let i = 0; i < (d.files || 0); i++) {
    const b = await DB.getFile(d.id, i); if (!b) continue;
    const img = document.createElement("img"); img.className = "pg"; img.src = URL.createObjectURL(b);
    img.onclick = () => img.classList.toggle("zoom");
    box.appendChild(img);
  }
}

async function saveForm(id, fd) {
  const d = await DB.get(id);
  const oldTopic = d.topic;
  for (const k of ["title", "topic", "sender", "doctype", "tags", "original", "note"]) d[k] = (fd.get(k) || "").trim();
  for (const k of ["date", "dueDate", "cancelBy", "warrantyUntil"]) d[k] = fd.get(k) || null;
  const a = (fd.get("amount") || "").trim().replace(/\./g, "").replace(",", ".");
  d.amount = a && !isNaN(+a) ? +a : null;
  d.paid = fd.get("paid") === "" ? null : fd.get("paid") === "1";
  d.confirmed = true;
  await DB.put(d); await reload();
  toast(oldTopic !== d.topic ? "Gespeichert – die App merkt sich das Thema" : "Gespeichert");
  viewDoc(id);
}
async function confirmDoc(id) { const d = await DB.get(id); d.confirmed = true; await DB.put(d); await reload(); toast("Bestätigt ✓"); viewDoc(id); }
async function deleteDoc(id) {
  if (!await ask("Dokument wirklich löschen? Das kann nicht rückgängig gemacht werden.", "Löschen")) return;
  await DB.del(id); await reload(); toast("Gelöscht"); history.length > 1 ? history.back() : go("/");
}

async function docAsFile(d) {
  const name = (d.title || "Dokument").replace(/[\\/:*?"<>|]/g, "-").slice(0, 80);
  if (d.kind === "pdf" || d.kind === "datei") {
    const b = await DB.getFile(d.id, 0);
    return new File([b], d.fileName || name + ".pdf", { type: b.type || d.mime || "application/octet-stream" });
  }
  const pdf = await imagesToPdf(d);
  return new File([pdf], `${d.date ? d.date + " " : ""}${name}.pdf`, { type: "application/pdf" });
}
async function imagesToPdf(d) {
  const { jsPDF } = window.jspdf; let doc = null;
  for (let i = 0; i < d.files; i++) {
    const b = await DB.getFile(d.id, i); if (!b) continue;
    const img = await Scan.loadImage(b); const w = 210, h = 210 * img.naturalHeight / img.naturalWidth;
    const data = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); });
    if (!doc) doc = new jsPDF({ unit: "mm", format: [w, h], orientation: h > w ? "p" : "l" }); else doc.addPage([w, h], h > w ? "p" : "l");
    doc.addImage(data, "JPEG", 0, 0, w, h);
  }
  return doc.output("blob");
}
async function shareDoc(id) {
  const d = await DB.get(id);
  busy("Wird vorbereitet …");
  try { const f = await docAsFile(d); busy(); await shareFile(f, d.title); }
  catch (e) { busy(); toast("Teilen nicht möglich: " + e.message); }
}
async function shareFile(file, title) {
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: title || file.name }); } catch (e) { if (e.name !== "AbortError") throw e; }
    return true;
  }
  const a = document.createElement("a"); a.href = URL.createObjectURL(file); a.download = file.name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  return false;
}
async function copyText(t) { try { await navigator.clipboard.writeText(t); toast("Kopiert"); } catch (e) { toast(t); } }

// ------------------------------------------------------------ Hinzufügen
function bindInputs() {
  $("#in-camera").addEventListener("change", e => { const f = [...e.target.files]; e.target.value = ""; if (f.length) addPhotos(f); });
  $("#in-files").addEventListener("change", e => { const f = [...e.target.files]; e.target.value = ""; if (f.length) importFiles(f); });
  $("#in-backup").addEventListener("change", e => { const f = e.target.files[0]; e.target.value = ""; if (f) importBackup(f); });
}
function openAdd() {
  sheet(`<h3>Dokument hinzufügen</h3>
    <button class="opt" onclick="closeSheet();startScan()"><span class="em">📷</span><span><b>Fotografieren</b><small>Papier abfotografieren – auch mehrseitig</small></span></button>
    <button class="opt" onclick="closeSheet();$('#in-files').click()"><span class="em">📎</span><span><b>Datei oder Foto auswählen</b><small>PDF aus Mail/Dateien, Fotos aus der Mediathek</small></span></button>`);
}
function startScan() { S.scan.pages = []; S.scan.target = null; $("#in-camera").click(); }
function addPagesTo(id) { S.scan.pages = []; S.scan.target = id; $("#in-camera").click(); }

async function addPhotos(files) {
  for (const f of files) {
    busy("Blatt wird gesucht …");
    try {
      const img = await Scan.loadImage(f);
      const canvas = Scan.toCanvas(img, 2600);
      const corners = Scan.findCorners(canvas);
      busy();
      const page = await cropEditor(canvas, corners);
      if (page) S.scan.pages.push(page);
    } catch (e) { busy(); toast(e.message); }
  }
  if (location.hash !== "#/scan") go("/scan"); else viewScan();
}

// Ecken verschieben, dann entzerren
function cropEditor(canvas, corners) {
  return new Promise(resolve => {
    let W = canvas.width, H = canvas.height;
    let q = corners ? corners.map(p => [...p]) : [[W * 0.04, H * 0.04], [W * 0.96, H * 0.04], [W * 0.96, H * 0.96], [W * 0.04, H * 0.96]];
    const ov = document.createElement("div"); ov.className = "crop";
    ov.innerHTML = `<div class="crop-top">${corners ? "Blatt erkannt – Ecken bei Bedarf verschieben" : "Kein Blatt erkannt – Ecken auf das Blatt ziehen"}</div>
      <div class="crop-stage"><canvas></canvas><svg></svg>${[0, 1, 2, 3].map(i => `<div class="h" data-i="${i}"></div>`).join("")}</div>
      <div class="crop-bar">
        <button data-a="cancel">Verwerfen</button>
        <button data-a="full">Ganzes Bild</button>
        <button data-a="rot">⟳ Drehen</button>
        <button data-a="ok" class="ok">Übernehmen</button></div>`;
    document.body.appendChild(ov);
    const stage = $(".crop-stage", ov), cv = $("canvas", ov), svg = $("svg", ov);
    let sc = 1, offX = 0, offY = 0;
    function layout() {
      const sw = stage.clientWidth, sh = stage.clientHeight;
      sc = Math.min(sw / W, sh / H); const dw = W * sc, dh = H * sc;
      offX = (sw - dw) / 2; offY = (sh - dh) / 2;
      cv.width = Math.round(dw * devicePixelRatio); cv.height = Math.round(dh * devicePixelRatio);
      Object.assign(cv.style, { width: dw + "px", height: dh + "px", left: offX + "px", top: offY + "px" });
      cv.getContext("2d").drawImage(canvas, 0, 0, cv.width, cv.height);
      draw();
    }
    function draw() {
      const pts = q.map(([x, y]) => [offX + x * sc, offY + y * sc]);
      svg.innerHTML = `<polygon points="${pts.map(p => p.join(",")).join(" ")}" />`;
      $$(".h", ov).forEach((h, i) => { h.style.left = pts[i][0] + "px"; h.style.top = pts[i][1] + "px"; });
    }
    let drag = -1;
    stage.addEventListener("pointerdown", e => {
      const r = stage.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
      let best = -1, bd = 60;
      q.forEach(([x, y], i) => { const dd = Math.hypot(offX + x * sc - px, offY + y * sc - py); if (dd < bd) { bd = dd; best = i; } });
      drag = best; if (drag >= 0) { stage.setPointerCapture(e.pointerId); e.preventDefault(); }
    });
    stage.addEventListener("pointermove", e => {
      if (drag < 0) return;
      const r = stage.getBoundingClientRect();
      q[drag] = [Math.max(0, Math.min(W, (e.clientX - r.left - offX) / sc)), Math.max(0, Math.min(H, (e.clientY - r.top - offY) / sc))];
      draw();
    });
    stage.addEventListener("pointerup", () => drag = -1);
    const onResize = () => layout(); window.addEventListener("resize", onResize);
    requestAnimationFrame(layout);
    const finish = v => { window.removeEventListener("resize", onResize); ov.remove(); resolve(v); };
    ov.addEventListener("click", async e => {
      const a = e.target.dataset && e.target.dataset.a; if (!a) return;
      if (a === "cancel") return finish(null);
      if (a === "full") { q = [[0, 0], [W, 0], [W, H], [0, H]]; return draw(); }
      if (a === "rot") {
        canvas = Scan.rotate(canvas, 90);
        q = q.map(([x, y]) => [H - y, x]); q = [q[3], q[0], q[1], q[2]];
        W = canvas.width; H = canvas.height; return layout();
      }
      if (a === "ok") {
        busy("Wird entzerrt …"); await new Promise(r => setTimeout(r, 30));
        try {
          const full = q.every(([x, y], i) => Math.hypot(x - [0, W, W, 0][i], y - [0, 0, H, H][i]) < 3);
          let out = full ? canvas : Scan.warp(canvas, q, 2400);
          Scan.whiten(out, S.scan.mode);
          const blob = await Scan.toBlob(out, 0.8);
          busy(); finish({ blob, url: URL.createObjectURL(blob) });
        } catch (err) { busy(); toast("Fehler: " + err.message); finish(null); }
      }
    });
  });
}

function viewScan() {
  header(S.scan.target ? "Seiten hinzufügen" : "Neuer Scan", true);
  const p = S.scan.pages;
  $("#view").innerHTML = `
    <div class="pages">${p.map((pg, i) => `<div class="page"><img src="${pg.url}"><span class="n">${i + 1}</span>
      <div class="ctl">${i > 0 ? `<button onclick="movePage(${i})">◀</button>` : ""}<button onclick="delPage(${i})">✕</button></div></div>`).join("")}
      <button class="addpage" onclick="$('#in-camera').click()"><span>📷</span>${p.length ? "Weitere Seite" : "Seite fotografieren"}</button>
    </div>
    <div class="card">
      <label>Bildstil für neue Fotos</label>
      <div class="seg">${[["farbe", "Farbe"], ["grau", "Graustufen"], ["sw", "Schwarz-Weiß"]].map(([k, l]) => `<button class="${S.scan.mode === k ? "on" : ""}" onclick="setMode('${k}')">${l}</button>`).join("")}</div>
      ${S.scan.target ? "" : `<label>Thema</label><select class="f" id="sc-topic"><option value="">✨ Automatisch erkennen</option>${S.topics.map(t => `<option>${esc(t.name)}</option>`).join("")}</select>`}
    </div>
    <button class="btn" ${p.length ? "" : "disabled"} onclick="saveScan()">Speichern (${p.length} Seite${p.length === 1 ? "" : "n"})</button>
    <p class="small center">Tipp: Blatt auf einen dunklen Untergrund legen, von oben fotografieren, gutes Licht.</p>`;
}
async function setMode(m) { S.scan.mode = m; await DB.kvSet("scanmode", m); viewScan(); }
function delPage(i) { URL.revokeObjectURL(S.scan.pages[i].url); S.scan.pages.splice(i, 1); viewScan(); }
function movePage(i) { const p = S.scan.pages; [p[i - 1], p[i]] = [p[i], p[i - 1]]; viewScan(); }

async function saveScan() {
  const pages = S.scan.pages; if (!pages.length) return;
  const topic = $("#sc-topic") ? $("#sc-topic").value : "";
  try {
    const texts = [];
    for (let i = 0; i < pages.length; i++) texts.push(await ocr(pages[i].blob, `Text wird erkannt – Seite ${i + 1} von ${pages.length}`));
    busy("Wird gespeichert …");
    if (S.scan.target) {
      const d = await DB.get(S.scan.target);
      for (let i = 0; i < pages.length; i++) await DB.putFile(d.id, d.files + i, pages[i].blob);
      d.files += pages.length; d.text = (d.text || "") + "\n\f\n" + texts.join("\n\f\n");
      await DB.put(d); await reload(); busy(); clearScan(); toast("Seiten hinzugefügt"); return go(`/dok/${d.id}`);
    }
    const id = await createDoc({ kind: "scan", mime: "image/jpeg", files: pages.map(p => p.blob), text: texts.join("\n\f\n"), topic, thumbFrom: pages[0].blob });
    busy(); clearScan(); go(`/dok/${id}`);
  } catch (e) { busy(); toast("Fehler: " + e.message); }
}
function clearScan() { S.scan.pages.forEach(p => URL.revokeObjectURL(p.url)); S.scan.pages = []; S.scan.target = null; }

async function importFiles(files) {
  const imgs = files.filter(f => /^image\//.test(f.type) || /\.(jpe?g|png|heic|heif)$/i.test(f.name));
  const others = files.filter(f => !imgs.includes(f));
  let lastId = null;
  for (const f of others) {
    try {
      if (f.type === "application/pdf" || /\.pdf$/i.test(f.name)) lastId = await importPdf(f);
      else {
        const text = /^text\//.test(f.type) ? await f.text() : "";
        lastId = await createDoc({ kind: "datei", mime: f.type, files: [f], text, fileName: f.name, titleHint: f.name.replace(/\.[^.]+$/, "") });
      }
    } catch (e) { toast(`${f.name}: ${e.message}`); }
  }
  busy();
  if (imgs.length) { S.scan.pages = []; S.scan.target = null; return addPhotos(imgs); }
  await reload();
  if (lastId) go(others.length === 1 ? `/dok/${lastId}` : "/pruefen");
}

async function importPdf(file) {
  busy(`${file.name} wird gelesen …`);
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data: data.slice() }).promise;
  let text = "";
  for (let i = 1; i <= Math.min(pdf.numPages, 30); i++) {
    const pg = await pdf.getPage(i); const tc = await pg.getTextContent();
    let line = "", lastY = null;
    for (const it of tc.items) {
      const y = it.transform[5];
      if (lastY !== null && Math.abs(y - lastY) > 3) { text += line.trim() + "\n"; line = ""; }
      line += it.str + (it.hasEOL ? "\n" : " "); lastY = y;
    }
    text += line.trim() + "\n\f\n";
  }
  const first = await pdf.getPage(1);
  const thumbCanvas = await renderPdfPage(first, 1.0);
  if (text.replace(/\s/g, "").length < 40 * Math.min(pdf.numPages, 3)) {
    text = "";
    const n = Math.min(pdf.numPages, 6);
    for (let i = 1; i <= n; i++) {
      const c = await renderPdfPage(await pdf.getPage(i), 2.2);
      text += await ocr(await Scan.toBlob(c, 0.9), `Gescanntes PDF – Texterkennung Seite ${i} von ${n}`) + "\n\f\n";
    }
  }
  return createDoc({ kind: "pdf", mime: "application/pdf", files: [file], text, fileName: file.name, thumbCanvas, pages: pdf.numPages });
}
async function renderPdfPage(page, scale) {
  const vp = page.getViewport({ scale }); const c = document.createElement("canvas");
  c.width = vp.width; c.height = vp.height;
  const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return c;
}

async function makeThumb(src) {
  let c;
  if (src instanceof HTMLCanvasElement) c = src; else c = Scan.toCanvas(await Scan.loadImage(src), 600);
  const t = document.createElement("canvas"); const sc = 220 / Math.max(c.width, c.height);
  t.width = Math.round(c.width * sc); t.height = Math.round(c.height * sc);
  t.getContext("2d").drawImage(c, 0, 0, t.width, t.height);
  return t.toDataURL("image/jpeg", 0.7);
}

async function createDoc({ kind, mime, files, text, topic, fileName, titleHint, thumbFrom, thumbCanvas, pages }) {
  const a = Analyse.analyze(text || titleHint || "", S.topics, model());
  const doc = {
    kind, mime, fileName: fileName || "", files: files.length, pages: pages || files.length,
    created: new Date().toISOString(), confirmed: !!topic, text: text || "",
    title: a.sender || a.doctype !== "Dokument" ? a.title : (titleHint || a.title), topic: topic || a.topic,
    doctype: a.doctype, sender: a.sender, date: a.date, amount: a.amount, tags: a.tags, note: "", original: "",
    dueDate: a.dueDate, paid: a.paid, warrantyUntil: a.warrantyUntil, contractEnd: a.contractEnd, cancelBy: a.cancelBy,
    noticePeriod: a.noticePeriod, costAmount: a.costAmount, costInterval: a.costInterval, taxRelevant: a.taxRelevant, iban: a.iban,
  };
  try { doc.thumb = thumbCanvas ? await makeThumb(thumbCanvas) : thumbFrom ? await makeThumb(thumbFrom) : ""; } catch (e) { doc.thumb = ""; }
  const id = await DB.put(doc);
  for (let i = 0; i < files.length; i++) await DB.putFile(id, i, files[i]);
  await reload();
  return id;
}

// ------------------------------------------------------------ Texterkennung (offline)
async function ocrWorker(onProgress) {
  if (!S.ocr) {
    S.ocr = Tesseract.createWorker("deu", 1, {
      workerPath: base + "worker.min.js", corePath: base.replace(/\/$/, ""), langPath: base.replace(/\/$/, ""),
      gzip: true, logger: m => S.ocrLog && S.ocrLog(m),
    });
  }
  S.ocrLog = onProgress;
  return S.ocr;
}
async function ocr(blob, label) {
  busy(label + " …");
  const w = await ocrWorker(m => {
    if (m.status === "recognizing text") busy(`${label} … ${Math.round(m.progress * 100)} %`);
    else if (/load|initializ/.test(m.status)) busy(`Texterkennung wird gestartet …`);
  });
  const r = await w.recognize(blob);
  return r.data.text || "";
}

// ------------------------------------------------------------ Einstellungen & Sicherung
async function viewSettings() {
  header("Einstellungen", true);
  const last = await DB.kvGet("lastBackup", null);
  let est = ""; try { const e = await navigator.storage.estimate(); est = `${(e.usage / 1048576).toFixed(1)} MB belegt`; } catch (e) { }
  let persisted = null; try { persisted = await navigator.storage.persisted(); } catch (e) { }
  const pin = await DB.kvGet("pin", null);
  $("#view").innerHTML = `
    <div class="card">
      <h3>💾 Sicherung</h3>
      <p class="small">Alle Dokumente liegen nur auf diesem iPhone. Mach regelmäßig eine Sicherung und lege sie mit „In Dateien sichern“ in iCloud Drive ab.</p>
      <p class="small">Letzte Sicherung: <b>${last ? new Date(last).toLocaleDateString("de-DE") : "noch nie"}</b> · ${S.docs.length} Dokumente · ${est}</p>
      <button class="btn" onclick="exportBackup()">Sicherung erstellen</button>
      <button class="btn sec" onclick="$('#in-backup').click()">Sicherung einspielen</button>
    </div>
    <div class="card">
      <h3>🗂 Themen</h3>
      <p class="small">Themen und Stichwörter für die automatische Sortierung anpassen.</p>
      <button class="btn sec" onclick="go('/themen')">Themen bearbeiten</button>
    </div>
    <div class="card">
      <h3>🔒 App-Sperre</h3>
      <p class="small">${pin ? "Die App ist mit einem Code geschützt." : "Optional: Beim Öffnen einen 4-stelligen Code verlangen."}</p>
      <button class="btn sec" onclick="setPin()">${pin ? "Code ändern" : "Code festlegen"}</button>
      ${pin ? `<button class="btn sec" onclick="removePin()">Code entfernen</button>` : ""}
    </div>
    <div class="card">
      <h3>🔴 Zähler am App-Symbol</h3>
      <p class="small">Zeigt am App-Symbol, wie viele Rechnungen offen oder Fristen in den nächsten 14 Tagen fällig sind.</p>
      <button class="btn sec" onclick="enableBadge()">Zähler einschalten</button>
    </div>
    <p class="small center">Speicher ${persisted ? "dauerhaft geschützt ✓" : persisted === false ? "nicht dauerhaft – App bitte über „Zum Home-Bildschirm“ nutzen" : ""}<br>Version ${APP_VERSION} · läuft komplett offline auf dem iPhone</p>`;
}

async function exportBackup() {
  busy("Sicherung wird erstellt …");
  try {
    const zip = new JSZip(); const docs = await DB.all();
    zip.file("archiv.json", JSON.stringify({ app: "dokumentenarchiv-ios", version: 1, exported: new Date().toISOString(), topics: S.topics, docs }, null, 1));
    for (const d of docs) for (let i = 0; i < (d.files || 0); i++) {
      const b = await DB.getFile(d.id, i); if (b) zip.file(`dateien/${d.id}_${i}`, b);
    }
    const blob = await zip.generateAsync({ type: "blob", compression: "STORE" });
    const f = new File([blob], `Archiv-Sicherung ${todayIso()}.zip`, { type: "application/zip" });
    busy();
    await shareFile(f, "Archiv-Sicherung");
    await DB.kvSet("lastBackup", Date.now());
    toast("Sicherung erstellt"); viewSettings();
  } catch (e) { busy(); toast("Fehler: " + e.message); }
}

async function importBackup(file) {
  if (!await ask("Sicherung einspielen? Dokumente aus der Sicherung werden hinzugefügt, doppelte übersprungen.", "Einspielen")) return;
  busy("Sicherung wird gelesen …");
  try {
    const zip = await JSZip.loadAsync(file);
    const meta = JSON.parse(await zip.file("archiv.json").async("string"));
    if (meta.topics && meta.topics.length) { S.topics = meta.topics; await DB.kvSet("topics", S.topics); }
    const have = new Set(S.docs.map(d => d.created + "|" + d.title));
    let n = 0;
    for (const d of meta.docs) {
      if (have.has(d.created + "|" + d.title)) continue;
      const old = d.id; delete d.id;
      const id = await DB.put(d);
      for (let i = 0; i < (d.files || 0); i++) {
        const f = zip.file(`dateien/${old}_${i}`);
        if (f) await DB.putFile(id, i, new Blob([await f.async("arraybuffer")], { type: d.kind === "scan" ? "image/jpeg" : d.mime || "" }));
      }
      n++; busy(`Sicherung wird eingespielt … ${n}`);
    }
    await reload(); busy(); toast(`${n} Dokumente eingespielt`); go("/");
  } catch (e) { busy(); toast("Das ist keine gültige Sicherung (" + e.message + ")"); }
}

function viewTopicsEdit() {
  header("Themen bearbeiten", true);
  $("#view").innerHTML = `<p class="small">Stichwörter mit Komma trennen. Die App lernt zusätzlich aus jedem Dokument, das du bestätigst oder korrigierst.</p>
    ${S.topics.map((t, i) => `<div class="card tedit">
      <div class="row"><input class="f em" data-i="${i}" data-k="icon" value="${esc(t.icon)}"><input class="f" data-i="${i}" data-k="name" value="${esc(t.name)}">
      <input class="f col" type="color" data-i="${i}" data-k="color" value="${esc(t.color)}"></div>
      <textarea class="f" rows="2" data-i="${i}" data-k="keywords">${esc(t.keywords)}</textarea>
      ${t.name !== "Sonstiges" ? `<button class="mini" onclick="delTopic(${i})">Thema entfernen</button>` : ""}</div>`).join("")}
    <button class="btn sec" onclick="addTopic()">＋ Neues Thema</button>
    <button class="btn" onclick="saveTopics()">Speichern</button>`;
}
function readTopicForm() {
  $$("[data-k]").forEach(el => { S.topics[+el.dataset.i][el.dataset.k] = el.value.trim(); });
}
async function saveTopics() {
  const old = await DB.kvGet("topics", []);
  readTopicForm();
  // umbenannte Themen in Dokumenten nachziehen
  for (let i = 0; i < Math.min(old.length, S.topics.length); i++) {
    if (old[i] && old[i].name !== S.topics[i].name) for (const d of S.docs.filter(d => d.topic === old[i].name)) { d.topic = S.topics[i].name; await DB.put(d); }
  }
  await DB.kvSet("topics", S.topics); await reload(); toast("Themen gespeichert"); go("/einstellungen");
}
function addTopic() { readTopicForm(); S.topics.splice(S.topics.length - 1, 0, { name: "Neues Thema", icon: "📂", color: "#6c757d", keywords: "" }); viewTopicsEdit(); }
async function delTopic(i) {
  readTopicForm(); const n = S.docs.filter(d => d.topic === S.topics[i].name).length;
  if (n && !await ask(`${n} Dokumente kommen dann nach „Sonstiges“. Fortfahren?`, "Entfernen")) return;
  for (const d of S.docs.filter(d => d.topic === S.topics[i].name)) { d.topic = "Sonstiges"; await DB.put(d); }
  S.topics.splice(i, 1); await DB.kvSet("topics", S.topics); await reload(); viewTopicsEdit();
}

// ------------------------------------------------------------ App-Sperre
const sha = async s => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("archiv:" + s)))].map(b => b.toString(16).padStart(2, "0")).join("");
async function setPin() {
  const a = await pinPad("Neuen Code eingeben"); if (!a) return;
  const b = await pinPad("Code wiederholen"); if (!b) return;
  if (a !== b) return toast("Codes stimmen nicht überein");
  await DB.kvSet("pin", await sha(a)); toast("Code festgelegt"); viewSettings();
}
async function removePin() { await DB.kvSet("pin", null); toast("Code entfernt"); viewSettings(); }
let hiddenAt = 0;
async function onVisibility() {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  updateBadge();
  if (hiddenAt && Date.now() - hiddenAt > 5 * 60000 && await DB.kvGet("pin", null)) await lockScreen();
}
async function lockScreen() {
  if ($(".pinpad")) return;
  const want = await DB.kvGet("pin", null);
  for (; ;) {
    const p = await pinPad("Code eingeben", true);
    if (p && await sha(p) === want) break;
    toast("Falscher Code");
  }
  route();
}
function pinPad(title, locked) {
  return new Promise(res => {
    let v = ""; const ov = document.createElement("div"); ov.className = "pinpad";
    const keys = [1, 2, 3, 4, 5, 6, 7, 8, 9, "", 0, "⌫"];
    ov.innerHTML = `<div class="pt">${title}</div><div class="pd"></div><div class="pk">${keys.map(k => `<button ${k === "" ? "disabled" : ""}>${k}</button>`).join("")}</div>${locked ? "" : `<button class="pc">Abbrechen</button>`}`;
    document.body.appendChild(ov);
    const dots = () => $(".pd", ov).innerHTML = [0, 1, 2, 3].map(i => `<span class="${i < v.length ? "on" : ""}"></span>`).join("");
    dots();
    ov.addEventListener("click", e => {
      const t = e.target; if (t.tagName !== "BUTTON") return;
      if (t.classList.contains("pc")) { ov.remove(); return res(null); }
      const k = t.textContent;
      if (k === "⌫") v = v.slice(0, -1); else if (/\d/.test(k) && v.length < 4) v += k;
      dots();
      if (v.length === 4) setTimeout(() => { ov.remove(); res(v); }, 150);
    });
  });
}

// ------------------------------------------------------------ App-Symbol-Zähler
async function enableBadge() {
  try {
    if (!("setAppBadge" in navigator)) return toast("Nur verfügbar, wenn die App vom Home-Bildschirm gestartet wird");
    const p = await Notification.requestPermission();
    if (p !== "granted") return toast("Mitteilungen wurden nicht erlaubt");
    await DB.kvSet("badge", true); updateBadge(); toast("Zähler eingeschaltet");
  } catch (e) { toast("Nicht möglich: " + e.message); }
}
async function updateBadge() {
  try {
    if (!("setAppBadge" in navigator) || !(await DB.kvGet("badge", false))) return;
    const n = deadlineItems().filter(x => !x.date || daysUntil(x.date) <= 14).length;
    n ? navigator.setAppBadge(n) : navigator.clearAppBadge();
  } catch (e) { }
}

// ------------------------------------------------------------ kleine Helfer
function sheet(html) {
  closeSheet();
  const o = document.createElement("div"); o.className = "sheet-bg"; o.onclick = e => { if (e.target === o) closeSheet(); };
  o.innerHTML = `<div class="sheet">${html}</div>`; document.body.appendChild(o);
}
function closeSheet() { const o = $(".sheet-bg"); if (o) o.remove(); }
function ask(text, okLabel) {
  return new Promise(res => {
    sheet(`<p>${esc(text)}</p><button class="btn danger" id="ask-ok">${esc(okLabel)}</button><button class="btn sec" id="ask-no">Abbrechen</button>`);
    $("#ask-ok").onclick = () => { closeSheet(); res(true); };
    $("#ask-no").onclick = () => { closeSheet(); res(false); };
  });
}
let toastT;
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 2600);
}
function busy(msg) {
  const b = $("#busy");
  if (msg) { $("#busy-t").textContent = msg; b.classList.add("show"); } else b.classList.remove("show");
}

window.addEventListener("DOMContentLoaded", () => {
  pdfjsLib.GlobalWorkerOptions.workerSrc = base + "pdf.worker.min.js";
  init().catch(e => { document.body.innerHTML = `<p style="padding:30px">Fehler beim Start: ${esc(e.message)}</p>`; });
});
