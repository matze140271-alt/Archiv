/* Erweiterungen v1.1: GiroCode, Kalender, Absender-Regeln, Seiten bearbeiten, Ausgaben, Steuer-PDF,
   Verträge, Face ID, verschlüsselte Sicherung, Kurzbefehl. */
"use strict";

// ------------------------------------------------------------ GiroCode
function girocodeCard(d) {
  if (d.paid !== false || !Analyse.ibanOk(d.iban || "")) return "";
  const payload = Analyse.epcPayload(d.payName || d.sender, d.iban, d.bic, d.amount, d.payRef || d.title);
  let img = "";
  try {
    qrcode.stringToBytes = s => [...new TextEncoder().encode(s)];
    const q = qrcode(0, "M"); q.addData(payload, "Byte"); q.make();
    img = q.createDataURL(6, 4);
  } catch (e) { return ""; }
  const n = d.dueDate ? daysUntil(d.dueDate) : null;
  return `<div class="card giro">
    <h3>💶 Mit Banking-App bezahlen</h3>
    <p class="small">In der Banking-App „Foto-Überweisung“ bzw. „GiroCode scannen“ wählen. Ist der Code auf diesem iPhone, ein Bildschirmfoto machen und in der Banking-App aus den Fotos laden.</p>
    <img class="qr" src="${img}" alt="GiroCode">
    <p class="small center"><b>${fmtEur(d.amount) || "Betrag selbst eintragen"}</b> an ${esc(d.payName || d.sender || "Empfänger")}<br>
      ${esc((d.iban || "").replace(/(.{4})/g, "$1 ").trim())}${d.payRef ? "<br>Zweck: " + esc(d.payRef) : ""}
      ${n != null ? `<br>${n < 0 ? `<b class="red">seit ${-n} Tagen fällig</b>` : `fällig ${n === 0 ? "heute" : "in " + n + " Tagen"} (${fmtDate(d.dueDate)})`}` : ""}</p>
    <div class="actions"><button class="btn sec" onclick="copyText('${esc(d.iban)}')">IBAN kopieren</button>
      <button class="btn" onclick="markPaidHere(${d.id})">✓ Bezahlt</button></div>
  </div>`;
}
async function markPaidHere(id) { const d = await DB.get(id); d.paid = true; await DB.put(d); await reload(); toast("Als bezahlt markiert"); viewDoc(id); }

// ------------------------------------------------------------ Kalender
const CAL_KINDS = {
  dueDate: { label: "Zahlen bis", alarms: ["-P3D", "-PT2H"] },
  cancelBy: { label: "Kündigen bis", alarms: ["-P14D", "-P3D"] },
  warrantyUntil: { label: "Garantie endet", alarms: ["-P30D"] },
  contractEnd: { label: "Vertrag endet", alarms: ["-P30D"] },
};
function calButtons(d) {
  const b = Object.entries(CAL_KINDS).filter(([k]) => d[k]).map(([k, v]) =>
    `<button type="button" class="mini" onclick="addToCalendar(${d.id},'${k}')">📅 ${v.label} ${fmtDate(d[k])}</button>`);
  return b.length ? `<label>In den iPhone-Kalender (mit Erinnerung)</label><div class="calrow">${b.join(" ")}</div>` : "";
}
const icsEsc = s => String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
function icsEvent(d, kind) {
  const k = CAL_KINDS[kind]; const day = d[kind].replace(/-/g, "");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const desc = [d.title, d.amount != null ? fmtEur(d.amount) : "", d.sender, "aus dem Dokumentenarchiv"].filter(Boolean).join(" · ");
  return ["BEGIN:VEVENT", `UID:archiv-${d.id}-${kind}-${day}@dokumentenarchiv`, `DTSTAMP:${stamp}`,
    `DTSTART:${day}T090000`, `DTEND:${day}T093000`, `SUMMARY:${icsEsc(k.label + ": " + d.title)}`, `DESCRIPTION:${icsEsc(desc)}`,
    ...k.alarms.flatMap(a => ["BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsEsc(k.label + ": " + d.title)}`, `TRIGGER:${a}`, "END:VALARM"]),
    "END:VEVENT"];
}
function icsFile(events, name) {
  const body = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Dokumentenarchiv//DE", "CALSCALE:GREGORIAN", ...events, "END:VCALENDAR"].join("\r\n");
  return new File([body], name, { type: "text/calendar" });
}
async function addToCalendar(id, kind) {
  const d = await DB.get(id);
  await deliverIcs(icsFile(icsEvent(d, kind), `${CAL_KINDS[kind].label} ${d.title}`.replace(/[\\/:*?"<>|]/g, "-").slice(0, 60) + ".ics"));
}
async function allDeadlinesToCalendar() {
  const ev = [];
  for (const d of S.docs) for (const k of Object.keys(CAL_KINDS)) if (d[k] && daysUntil(d[k]) >= 0 && (k !== "dueDate" || d.paid === false)) ev.push(...icsEvent(d, k));
  if (!ev.length) return toast("Keine kommenden Fristen");
  await deliverIcs(icsFile(ev, "Archiv-Fristen.ics"));
}
async function deliverIcs(file) {
  // 1. Teilen-Menü (dort „Kalender“ wählen), 2. Download – Safari öffnet .ics dann im Kalender
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file] }); return; }
  } catch (e) { if (e.name === "AbortError") return; }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a"); a.href = url; a.download = file.name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 10000);
  toast("Datei öffnen → „Zum Kalender hinzufügen“");
}

// ------------------------------------------------------------ Absender-Regeln
const GENERIC_WORDS = new Set(["stadt", "stadtwerke", "praxis", "dr", "dr.", "finanzamt", "gemeinde", "autohaus", "deutsche", "die", "der", "das",
  "landkreis", "landratsamt", "amtsgericht", "zahnarztpraxis", "klinikum", "sparkasse", "volksbank", "kanzlei", "firma"]);
function senderKey(sender) {
  const w = (sender || "").replace(/[.,]/g, " ").split(/\s+/).filter(x => x.length > 1 && !/^(gmbh|ag|kg|se|mbh|a|g|e|v|co|ohg|ug)$/i.test(x));
  if (!w.length) return (sender || "").trim();
  return GENERIC_WORDS.has(w[0].toLowerCase()) && w[1] ? `${w[0]} ${w[1]}` : w[0];
}
async function ruleFromDoc(id) {
  const d = await DB.get(id); const key = senderKey(d.sender);
  const rules = await DB.kvGet("rules", []);
  const i = rules.findIndex(r => r.match === key.toLowerCase());
  const rule = { match: key.toLowerCase(), name: key, topic: d.topic };
  if (i >= 0) rules[i] = rule; else rules.push(rule);
  await DB.kvSet("rules", rules);
  // vorhandene, noch ungeprüfte Dokumente gleich mitziehen
  let n = 0;
  for (const x of S.docs) if (!x.confirmed && x.id !== id && matchesRule(x, rule)) { x.topic = rule.topic; x.confirmed = true; await DB.put(x); n++; }
  await reload();
  toast(`Regel gespeichert${n ? ` – ${n} weitere Dokumente einsortiert` : ""}`);
}
function matchesRule(doc, r) {
  const head = ((doc.sender || "") + " " + (doc.text || "").slice(0, 1500)).toLowerCase().replace(/\s+/g, " ");
  return head.includes(r.match);
}
async function applyRules(doc) {
  const rules = await DB.kvGet("rules", []);
  const r = rules.find(x => S.topics.some(t => t.name === x.topic) && matchesRule(doc, x));
  if (r) { doc.topic = r.topic; doc.confirmed = true; doc.rule = r.name; }
}
async function viewRules() {
  header("Absender-Regeln", true);
  const rules = await DB.kvGet("rules", []);
  $("#view").innerHTML = `<p class="small">Steht der Name im Briefkopf oder Absender, landet das Dokument automatisch im Thema – ohne Nachfrage.
    Am schnellsten legst du Regeln direkt im Dokument mit „📌 Alles von … immer nach …“ an.</p>
    <div class="list">${rules.map((r, i) => `<div class="item"><div class="meta"><div class="it">„${esc(r.name)}“</div>
      <div class="is">→ ${esc(topicOf(r.topic).icon)} ${esc(r.topic)}</div></div><button class="mini" onclick="delRule(${i})">Löschen</button></div>`).join("")
    || `<p class="empty">Noch keine Regeln.</p>`}</div>
    <div class="card"><h3>Neue Regel</h3>
      <label>Wenn im Dokument steht</label><input class="f" id="r-m" placeholder="z. B. Debeka">
      <label>dann Thema</label><select class="f" id="r-t">${S.topics.map(t => `<option>${esc(t.name)}</option>`).join("")}</select>
      <button class="btn" onclick="addRule()">Regel anlegen</button></div>`;
}
async function addRule() {
  const m = $("#r-m").value.trim(); if (m.length < 3) return toast("Mindestens 3 Zeichen");
  const rules = await DB.kvGet("rules", []);
  rules.push({ match: m.toLowerCase(), name: m, topic: $("#r-t").value });
  await DB.kvSet("rules", rules); toast("Regel angelegt"); viewRules();
}
async function delRule(i) { const rules = await DB.kvGet("rules", []); rules.splice(i, 1); await DB.kvSet("rules", rules); viewRules(); }

// ------------------------------------------------------------ Seiten bearbeiten
async function viewPageEdit(id) {
  const d = await DB.get(id); if (!d) return go("/");
  header("Seiten bearbeiten", true);
  const urls = [];
  for (let i = 0; i < d.files; i++) { const b = await DB.getFile(id, i); urls.push(b ? URL.createObjectURL(b) : ""); }
  $("#view").innerHTML = `<div class="pages">${urls.map((u, i) => `<div class="page"><img src="${u}"><span class="n">${i + 1}</span>
      <div class="ctl">${i > 0 ? `<button onclick="pageOp(${id},${i},'left')">◀</button>` : ""}<button onclick="pageOp(${id},${i},'rot')">⟳</button>
      ${d.files > 1 ? `<button onclick="pageOp(${id},${i},'del')">✕</button>` : ""}</div></div>`).join("")}
    <button class="addpage" onclick="addPagesTo(${id})"><span>📷</span>Seite dazu</button></div>
    <p class="small center">◀ nach vorne · ⟳ drehen · ✕ löschen</p>
    <button class="btn" onclick="go('/dok/${id}')">Fertig</button>`;
}
async function pageOp(id, i, op) {
  const d = await DB.get(id);
  const blobs = []; for (let k = 0; k < d.files; k++) blobs.push(await DB.getFile(id, k));
  if (op === "left" && i > 0) [blobs[i - 1], blobs[i]] = [blobs[i], blobs[i - 1]];
  if (op === "del") { if (!await ask(`Seite ${i + 1} löschen?`, "Löschen")) return; blobs.splice(i, 1); }
  if (op === "rot") {
    busy("Wird gedreht …");
    const c = Scan.rotate(Scan.toCanvas(await Scan.loadImage(blobs[i]), 4000), 90);
    blobs[i] = await Scan.toBlob(c, 0.85); busy();
  }
  for (let k = 0; k < d.files; k++) await DB.delFile(id, k);
  for (let k = 0; k < blobs.length; k++) await DB.putFile(id, k, blobs[k]);
  d.files = blobs.length; d.pages = blobs.length;
  try { d.thumb = await makeThumb(blobs[0]); } catch (e) { }
  await DB.put(d); await reload(); viewPageEdit(id);
}

// ------------------------------------------------------------ Ausgaben
const NO_SPEND = new Set(["Gehaltsabrechnung", "Kontoauszug", "Steuerbescheid", "Angebot"]);
function spendDocs(year) {
  return S.docs.filter(d => d.amount != null && d.amount > 0 && !NO_SPEND.has(d.doctype) && (d.date || d.created || "").startsWith(String(year)));
}
function viewSpending(year) {
  const years = [...new Set(S.docs.filter(d => d.amount != null).map(d => +(d.date || d.created).slice(0, 4)))].sort((a, b) => b - a);
  year = year || years[0] || new Date().getFullYear();
  header(`Ausgaben ${year}`, true);
  const docs = spendDocs(year); const total = docs.reduce((s, d) => s + d.amount, 0);
  const byTopic = {}; docs.forEach(d => byTopic[d.topic] = (byTopic[d.topic] || 0) + d.amount);
  const byMonth = Array(12).fill(0); docs.forEach(d => byMonth[+(d.date || d.created).slice(5, 7) - 1] += d.amount);
  const maxT = Math.max(1, ...Object.values(byTopic)), maxM = Math.max(1, ...byMonth);
  const prev = spendDocs(year - 1), prevTotal = prev.reduce((s, d) => s + d.amount, 0);
  const prevTopic = {}; prev.forEach(d => prevTopic[d.topic] = (prevTopic[d.topic] || 0) + d.amount);
  const pct = (now, before) => before > 0 ? Math.round((now - before) / before * 100) : null;
  const chg = (now, before) => { const p = pct(now, before); return p == null ? "" : `<span class="${p > 0 ? "red" : "green"}">${p > 0 ? "+" : ""}${p} %</span>`; };
  const bySender = (list) => { const m = {}; list.forEach(d => { const k = senderKey(d.sender) || d.topic; m[k] = (m[k] || 0) + d.amount; }); return m; };
  const sNow = bySender(docs), sPrev = bySender(prev);
  const moves = [...new Set([...Object.keys(sNow), ...Object.keys(sPrev)])].map(k => [k, (sNow[k] || 0) - (sPrev[k] || 0), sNow[k] || 0, sPrev[k] || 0])
    .filter(x => x[2] && x[3]).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 6);
  const tax = S.docs.filter(d => d.taxRelevant && (d.date || d.created || "").startsWith(String(year)));
  $("#view").innerHTML = `
    <div class="seg">${years.slice(0, 5).map(y => `<button class="${y === year ? "on" : ""}" onclick="go('/ausgaben/${y}')">${y}</button>`).join("") || `<button class="on">${year}</button>`}</div>
    <div class="card center"><div class="small">Summe laut Belegen</div><div class="big">${fmtEur(total)}</div><div class="small">${docs.length} Belege mit Betrag${prevTotal ? ` · Vorjahr ${fmtEur(prevTotal)} ${chg(total, prevTotal)}` : ""}</div></div>
    <h2>Nach Thema</h2>
    <div class="card">${Object.entries(byTopic).sort((a, b) => b[1] - a[1]).map(([t, v]) => `
      <div class="bar"><span>${esc(topicOf(t).icon)} ${esc(t)}</span><b>${fmtEur(v)} ${chg(v, prevTopic[t] || 0)}</b></div>
      <div class="track"><div style="width:${(v / maxT * 100).toFixed(1)}%;background:${topicOf(t).color}"></div></div>`).join("") || `<p class="small">Keine Beträge in diesem Jahr.</p>`}</div>
    ${moves.length ? `<h2>Vergleich zu ${year - 1}</h2><div class="card">${moves.map(([k, dlt, n, b]) =>
      `<div class="bar"><span>${esc(k)}</span><b>${dlt > 0 ? "+" : ""}${fmtEur(dlt)} ${chg(n, b)}</b></div><div class="small">${fmtEur(b)} → ${fmtEur(n)}</div>`).join("")}</div>` : ""}
    <h2>Nach Monat</h2>
    <div class="card months">${byMonth.map((v, i) => `<div class="mcol"><div class="mbar" style="height:${(v / maxM * 100).toFixed(1)}%" title="${fmtEur(v)}"></div>
      <span>${"JFMAMJJASOND"[i]}</span></div>`).join("")}</div>
    <button class="btn sec" onclick="exportCsv(${year})">📄 Als CSV für Excel exportieren</button>
    <button class="btn sec" onclick="taxPdf(${year})">🧾 Steuer-PDF ${year} (${tax.length} Dokumente)</button>
    <p class="small">Nicht mitgezählt: Gehaltsabrechnungen, Kontoauszüge, Steuerbescheide und Angebote. Gutschriften und Erstattungen bitte als Betrag korrigieren.</p>`;
}
async function exportCsv(year) {
  const csvEsc = v => { v = String(v ?? ""); return /[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
  const rows = [["Datum", "Titel", "Absender", "Thema", "Art", "Betrag", "Bezahlt", "Steuerrelevant", "Schlagworte", "Notiz"]];
  for (const d of S.docs.filter(d => (d.date || d.created || "").startsWith(String(year))).sort((a, b) => (a.date || "").localeCompare(b.date || "")))
    rows.push([fmtDate(d.date), d.title, d.sender, d.topic, d.doctype, d.amount != null ? d.amount.toFixed(2).replace(".", ",") : "",
      d.paid === true ? "ja" : d.paid === false ? "nein" : "", d.taxRelevant ? "ja" : "", d.tags, d.note]);
  const csv = "\ufeff" + rows.map(r => r.map(csvEsc).join(";")).join("\r\n");
  await shareFile(new File([csv], `Archiv ${year}.csv`, { type: "text/csv" }), `Archiv ${year}`);
}

// ------------------------------------------------------------ Steuer-PDF
function taxPdfAsk() {
  const years = [...new Set(S.docs.filter(d => d.taxRelevant).map(d => +(d.date || d.created).slice(0, 4)))].sort((a, b) => b - a);
  if (!years.length) return toast("Noch keine Dokumente als „steuerrelevant“ markiert");
  sheet(`<h3>Steuer-PDF</h3><p class="small">Alle steuerrelevanten Dokumente eines Jahres als ein PDF – mit Inhaltsverzeichnis. Zum Weiterleiten an den Steuerberater oder fürs ELSTER-Belegarchiv.</p>
    ${years.map(y => `<button class="opt" onclick="closeSheet();taxPdf(${y})"><span class="em">🧾</span><span><b>${y}</b><small>${S.docs.filter(d => d.taxRelevant && (d.date || d.created).startsWith(String(y))).length} Dokumente</small></span></button>`).join("")}`);
}
async function taxPdf(year) {
  const docs = S.docs.filter(d => d.taxRelevant && (d.date || d.created || "").startsWith(String(year)))
    .sort((a, b) => a.topic.localeCompare(b.topic) || (a.date || "").localeCompare(b.date || ""));
  if (!docs.length) return toast("Keine steuerrelevanten Dokumente " + year);
  busy("Steuer-PDF wird erstellt …");
  try {
    const { jsPDF } = window.jspdf; const pdf = new jsPDF({ unit: "mm", format: "a4" });
    const ascii = s => String(s || "").replace(/[^\x20-\x7e\u00a0-\u00ff]/g, "");
    pdf.setFontSize(18); pdf.text(`Steuerunterlagen ${year}`, 20, 25);
    pdf.setFontSize(10); pdf.text(`Erstellt am ${new Date().toLocaleDateString("de-DE")} - ${docs.length} Dokumente`, 20, 32);
    let y = 45;
    docs.forEach((d, i) => {
      if (y > 280) { pdf.addPage(); y = 20; }
      pdf.text(ascii(`${i + 1}. ${fmtDate(d.date) || "-"}  ${d.title}`).slice(0, 80), 20, y);
      pdf.text(ascii(`${d.topic}${d.amount != null ? "  " + d.amount.toFixed(2).replace(".", ",") + " EUR" : ""}`), 120, y);
      y += 6;
    });
    for (let i = 0; i < docs.length; i++) {
      busy(`Steuer-PDF wird erstellt … ${i + 1} von ${docs.length}`);
      for (const img of await docImages(docs[i])) {
        const w = 210, h = Math.min(297, 210 * img.h / img.w), ww = h < 297 ? w : 297 * img.w / img.h;
        pdf.addPage([210, 297], "p"); pdf.addImage(img.data, "JPEG", (210 - ww) / 2, 0, ww, h);
      }
    }
    const f = new File([pdf.output("blob")], `Steuerunterlagen ${year}.pdf`, { type: "application/pdf" });
    busy(); await shareFile(f, `Steuerunterlagen ${year}`);
  } catch (e) { busy(); toast("Fehler: " + e.message); }
}
const blobToDataUrl = b => new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); });
async function docImages(d) {
  const out = [];
  if (d.kind === "scan") {
    for (let i = 0; i < d.files; i++) {
      const b = await DB.getFile(d.id, i); if (!b) continue;
      const im = await Scan.loadImage(b); out.push({ data: await blobToDataUrl(b), w: im.naturalWidth, h: im.naturalHeight });
    }
  } else if (d.kind === "pdf") {
    const b = await DB.getFile(d.id, 0); if (!b) return out;
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(await b.arrayBuffer()) }).promise;
    for (let i = 1; i <= Math.min(doc.numPages, 20); i++) {
      const c = await renderPdfPage(await doc.getPage(i), 1.6);
      out.push({ data: c.toDataURL("image/jpeg", 0.78), w: c.width, h: c.height });
    }
  }
  return out;
}

// ------------------------------------------------------------ Verträge & Abos
const PER_MONTH = { monatlich: 1, vierteljährlich: 1 / 3, halbjährlich: 1 / 6, jährlich: 1 / 12 };
function cancelDate(end, notice) {
  const m = (notice || "").toLowerCase().match(/(\d+)\s*(monat|woche|tag|jahr)/); if (!m) return null;
  const e = new Date(end + "T00:00:00"); const n = +m[1];
  const d = m[2] === "monat" ? Analyse.addMonths(e, -n) : m[2] === "jahr" ? Analyse.addMonths(e, -12 * n) : Analyse.addDays(e, -(m[2] === "woche" ? 7 * n : n));
  return Analyse.iso(d);
}
function viewContracts() {
  header("Verträge & Abos", true);
  const docs = S.docs.filter(d => d.contractActive !== false && (d.costAmount || d.contractEnd || d.noticePeriod || d.cancelBy));
  const monthly = d => d.costAmount ? d.costAmount * (PER_MONTH[d.costInterval] ?? 1) : 0;
  const total = docs.reduce((s, d) => s + monthly(d), 0);
  docs.sort((a, b) => (a.cancelBy || a.contractEnd || "9999").localeCompare(b.cancelBy || b.contractEnd || "9999"));
  $("#view").innerHTML = `
    <div class="card center"><div class="small">Laufende Verträge kosten zusammen</div><div class="big">${fmtEur(total)} <span class="small">/ Monat</span></div>
      <div class="small">= ${fmtEur(total * 12)} im Jahr · ${docs.length} Verträge</div></div>
    ${docs.length ? `<div class="list">${docs.map(d => {
      const c = d.cancelBy ? daysUntil(d.cancelBy) : null;
      return `<a class="item" href="#/dok/${d.id}"><div class="meta"><div class="it">${esc(d.title)}</div>
        <div class="is">${esc(topicOf(d.topic).icon)} ${d.costAmount ? fmtEur(d.costAmount) + " " + (d.costInterval || "") : "Kosten nicht erfasst"}
        ${d.noticePeriod ? " · Frist " + esc(d.noticePeriod) : ""}</div>
        ${d.cancelBy ? `<div class="is ${c != null && c <= 30 ? "red" : ""}">Kündigen bis ${fmtDate(d.cancelBy)}${c != null ? ` (${c < 0 ? "vorbei" : "in " + c + " Tagen"})` : ""}</div>`
        : d.contractEnd ? `<div class="is">Ende ${fmtDate(d.contractEnd)}</div>` : ""}</div></a>`;
    }).join("")}</div>` : `<p class="empty">Noch keine Verträge erfasst. Öffne einen Vertrag, Versicherungsschein oder ein Abo und trage unter „Vertrag &amp; Kosten“ Betrag und Laufzeit ein.</p>`}
    <button class="btn sec" onclick="allDeadlinesToCalendar()">📅 Alle kommenden Fristen in den Kalender</button>
    <p class="small">Gekündigte Verträge im Dokument bei „Vertrag läuft noch“ abhaken – dann fallen sie hier raus.</p>`;
}

// ------------------------------------------------------------ Face ID (WebAuthn, nur auf diesem Gerät)
const rnd = n => crypto.getRandomValues(new Uint8Array(n));
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function toggleFaceId() {
  if (await DB.kvGet("faceid", null)) { await DB.kvSet("faceid", null); toast("Face ID ausgeschaltet"); return viewSettings(); }
  try {
    if (!window.PublicKeyCredential || !(await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()))
      return toast("Face ID ist hier nicht verfügbar");
    const cred = await navigator.credentials.create({ publicKey: {
      rp: { name: "Dokumentenarchiv" }, user: { id: rnd(16), name: "archiv", displayName: "Dokumentenarchiv" },
      challenge: rnd(32), pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "discouraged" },
      timeout: 60000, attestation: "none" } });
    await DB.kvSet("faceid", b64(cred.rawId)); toast("Face ID eingeschaltet"); viewSettings();
  } catch (e) { toast(e.name === "NotAllowedError" ? "Abgebrochen" : "Face ID nicht möglich: " + e.message); }
}
async function faceIdCheck(id) {
  try {
    const r = await navigator.credentials.get({ publicKey: { challenge: rnd(32), allowCredentials: [{ type: "public-key", id: unb64(id) }],
      userVerification: "required", timeout: 60000 } });
    return !!(r && r.response && new DataView(r.response.authenticatorData).getUint8(32) & 0x04);
  } catch (e) { return false; }
}

// ------------------------------------------------------------ Verschlüsselte Sicherung (AES-256-GCM)
const MAGIC = new TextEncoder().encode("ARCHIVENC1");
async function keyFrom(pw, salt) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 250000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function encryptBlob(blob, pw) {
  const salt = rnd(16), iv = rnd(12);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await keyFrom(pw, salt), await blob.arrayBuffer());
  return new Blob([MAGIC, salt, iv, ct]);
}
async function isEncrypted(file) {
  const h = new Uint8Array(await file.slice(0, MAGIC.length).arrayBuffer());
  return h.length === MAGIC.length && h.every((v, i) => v === MAGIC[i]);
}
async function decryptBlob(file, pw) {
  const buf = new Uint8Array(await file.arrayBuffer()); const o = MAGIC.length;
  const salt = buf.slice(o, o + 16), iv = buf.slice(o + 16, o + 28);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await keyFrom(pw, salt), buf.slice(o + 28));
  return new Blob([pt], { type: "application/zip" });
}
function passwordSheet(title, text, optional) {
  return new Promise(res => {
    sheet(`<h3>${esc(title)}</h3><p class="small">${esc(text)}</p>
      <input class="f" type="password" id="pw1" placeholder="Passwort" autocomplete="new-password">
      ${optional ? `<input class="f" type="password" id="pw2" placeholder="Passwort wiederholen" style="margin-top:8px" autocomplete="new-password">` : ""}
      <button class="btn" id="pw-ok">${optional ? "Verschlüsselt sichern" : "Öffnen"}</button>
      ${optional ? `<button class="btn sec" id="pw-plain">Ohne Passwort sichern</button>` : ""}
      <button class="btn sec" id="pw-no">Abbrechen</button>`);
    setTimeout(() => $("#pw1") && $("#pw1").focus(), 100);
    $("#pw-ok").onclick = () => {
      const a = $("#pw1").value;
      if (a.length < 6) return toast("Mindestens 6 Zeichen");
      if (optional && a !== $("#pw2").value) return toast("Passwörter stimmen nicht überein");
      closeSheet(); res(a);
    };
    if (optional) $("#pw-plain").onclick = () => { closeSheet(); res(""); };
    $("#pw-no").onclick = () => { closeSheet(); res(null); };
  });
}

// ------------------------------------------------------------ Kurzbefehl
function shortcutHelp() {
  sheet(`<h3>📥 PDFs aus Mail übernehmen</h3>
    <p class="small"><b>Ohne Kurzbefehl:</b> PDF in Mail antippen → Teilen → „In Dateien sichern“. Dann hier ＋ → „Datei auswählen“ – mehrere Dateien auf einmal gehen.</p>
    <p class="small"><b>Mit Kurzbefehl „Ins Archiv“</b> (einmal einrichten, ca. 1 Minute):</p>
    <ol class="small steps">
      <li>App <b>Kurzbefehle</b> öffnen → <b>＋</b></li>
      <li>Oben auf ⓘ tippen → <b>„Im Share-Sheet anzeigen“</b> einschalten, Typ <b>PDFs und Bilder</b></li>
      <li>Aktion <b>„Datei sichern“</b> hinzufügen, „Speicherort erfragen“ aus, Ordner <b>iCloud Drive › Archiv-Eingang</b></li>
      <li>Aktion <b>„URL öffnen“</b> hinzufügen mit der Adresse dieser App: <b>${esc(location.origin + location.pathname)}#/eingang</b></li>
      <li>Name: <b>Ins Archiv</b> → Fertig</li>
    </ol>
    <p class="small">Danach in Mail: PDF → Teilen → <b>Ins Archiv</b>. Die App öffnet sich und zeigt den Knopf „Aus Archiv-Eingang übernehmen“ – dort die neuen Dateien markieren.
    Übernommene Dateien kannst du im Ordner anschließend löschen.</p>
    <button class="btn sec" onclick="closeSheet()">Schließen</button>`);
}
function viewInbox() {
  header("Eingang", true);
  $("#view").innerHTML = `<div class="card center"><p>📥 Neue Dateien liegen in <b>iCloud Drive › Archiv-Eingang</b>.</p>
    <button class="btn" onclick="$('#in-files').click()">Aus Archiv-Eingang übernehmen</button>
    <p class="small">Im Auswahlfenster den Ordner öffnen und die Dateien markieren.</p></div>`;
}
