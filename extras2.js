/* Erweiterungen v1.2: Dubletten, ähnliche Dokumente, Garantien, Aufbewahrung, Notfall-Mappe, Personen. */
"use strict";

// ------------------------------------------------------------ Dubletten
async function sha256(blob) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))].map(b => b.toString(16).padStart(2, "0")).join("");
}
const wordSet = t => new Set(Analyse.tokenize(t || "").slice(0, 600));
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let n = 0; for (const x of a) if (b.has(x)) n++;
  return n / (a.size + b.size - n);
}
async function markDuplicate(doc, files) {
  if (doc.kind !== "scan" && files[0]) doc.fileHash = await sha256(files[0]);
  const ws = wordSet(doc.text);
  for (const o of S.allDocs) {
    if (doc.fileHash && o.fileHash === doc.fileHash) { doc.duplicateOf = o.id; return; }
    if (ws.size >= 25 && o.text && jaccard(ws, wordSet(o.text)) >= 0.85) { doc.duplicateOf = o.id; return; }
  }
}
function dupBanner(d) {
  if (!d.duplicateOf) return "";
  const o = S.allDocs.find(x => x.id === d.duplicateOf);
  if (!o) return "";
  return `<div class="banner warnb">⚠️ <b>Vermutlich doppelt:</b> sieht aus wie „${esc(o.title)}“${o.date ? " vom " + fmtDate(o.date) : ""}.
    <div class="actions"><button class="btn small" onclick="deleteDupe(${d.id})">Dieses löschen</button>
    <button class="btn small sec" onclick="go('/dok/${o.id}')">Vergleichen</button>
    <button class="btn small sec" onclick="notDupe(${d.id})">Kein Duplikat</button></div></div>`;
}
async function deleteDupe(id) { const d = await DB.get(id); const o = d.duplicateOf; await DB.del(id); await reload(); toast("Duplikat gelöscht"); go(`/dok/${o}`); }
async function notDupe(id) { const d = await DB.get(id); d.duplicateOf = null; await DB.put(d); await reload(); viewDoc(id); }

// ------------------------------------------------------------ Ähnliche Dokumente
function tfVec(text) { const m = new Map(); for (const t of Analyse.tokenize(text || "").slice(0, 1500)) m.set(t, (m.get(t) || 0) + 1); return m; }
function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (const [k, v] of a) { na += v * v; const w = b.get(k); if (w) dot += v * w; }
  for (const v of b.values()) nb += v * v;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
function renderSimilar(d) {
  const box = $("#similar"); if (!box) return;
  const key = d.sender ? senderKey(d.sender).toLowerCase() : "";
  const v = tfVec(d.text + " " + d.title);
  const scored = S.allDocs.filter(o => o.id !== d.id && o.id !== d.duplicateOf).map(o => {
    let s = cosine(v, tfVec(o.text + " " + o.title));
    if (key && key.length >= 3 && (o.sender || "").toLowerCase().includes(key)) s += 0.5;
    return [s, o];
  }).filter(x => x[0] >= 0.35).sort((a, b) => b[0] - a[0]).slice(0, 5).map(x => x[1]);
  if (!scored.length) return;
  box.innerHTML = `<h2>Dazu passend</h2>${list(scored.sort((a, b) => (b.date || "").localeCompare(a.date || "")))}`;
}

// ------------------------------------------------------------ Garantien
function warrantyOf(d) {
  if (d.warrantyUntil) return { until: d.warrantyUntil, art: "Garantie" };
  const t = ((d.text || "").slice(0, 2500) + " " + d.sender).toLowerCase();
  const purchase = d.topic === "Rechnungen & Kaufbelege" || d.topic === "Garantie & Anleitungen" ||
    (!["Wohnen & Energie", "Versicherungen", "Verträge & Abos", "Steuern", "Arbeit & Gehalt", "Gesundheit", "Behörden & Ausweise"].includes(d.topic)
      && /(artikel|stück|menge|seriennummer|gerät|kaufbeleg|bestellung|lieferung|mediamarkt|saturn|amazon|ikea|bauhaus|hornbach|obi\b|cyberport)/.test(t));
  if (d.date && purchase && ["Rechnung", "Quittung"].includes(d.doctype))
    return { until: Analyse.iso(Analyse.addMonths(new Date(d.date + "T00:00:00"), 24)), art: "Gesetzl. Gewährleistung", auto: true };
  return null;
}
function viewWarranty() {
  header("Garantien", true);
  const items = S.docs.map(d => ({ d, w: warrantyOf(d) })).filter(x => x.w).sort((a, b) => a.w.until.localeCompare(b.w.until));
  const run = items.filter(x => daysUntil(x.w.until) >= 0), old = items.filter(x => daysUntil(x.w.until) < 0).reverse().slice(0, 20);
  const row = ({ d, w }) => { const n = daysUntil(w.until);
    return `<a class="item" href="#/dok/${d.id}"><div class="thumb">${d.thumb ? `<img src="${d.thumb}">` : "🧾"}</div><div class="meta"><div class="it">${esc(d.title)}</div>
      <div class="is">${w.art} bis ${fmtDate(w.until)}${n >= 0 ? ` · <span class="${n <= 60 ? "red" : ""}">noch ${n > 60 ? Math.round(n / 30) + " Monate" : n + " Tage"}</span>` : ""}</div>
      ${d.amount != null ? `<div class="is">${fmtEur(d.amount)} · gekauft ${fmtDate(d.date)}</div>` : ""}</div></a>`; };
  $("#view").innerHTML = `<p class="small">Kaufbelege mit Garantie oder der gesetzlichen Gewährleistung (2 Jahre ab Kauf). Eigene Garantie-Daten trägst du im Dokument unter „Fristen &amp; Zahlung“ ein.</p>
    <h2>Läuft noch (${run.length})</h2>${run.length ? `<div class="list">${run.map(row).join("")}</div>` : `<p class="empty">Nichts mit laufender Garantie.</p>`}
    ${old.length ? `<h2>Abgelaufen</h2><div class="list faded">${old.map(row).join("")}</div>` : ""}`;
}

// ------------------------------------------------------------ Aufbewahrung (Faustregeln für Privatleute)
const ORIGINAL_RE = /(geburtsurkunde|heiratsurkunde|sterbeurkunde|eheurkunde|abstammungsurkunde|testament|erbschein|notar|grundbuch|kaufvertrag (?:über|für) (?:das|die|eine) (?:grundstück|wohnung|haus)|zulassungsbescheinigung teil ii|fahrzeugbrief|zeugnis|diplom|meisterbrief|rentenbescheid|versicherungsverlauf|schwerbehindertenausweis|einbürgerung|darlehensvertrag)/;
function retentionInfo(d, autoOnly) {
  if (!autoOnly && d.retention === "dauerhaft") return { kind: "original", label: "Original dauerhaft aufheben (selbst festgelegt)" };
  if (!autoOnly && d.retention === "scan") return { kind: "scan", label: "Scan genügt (selbst festgelegt)" };
  const t = ((d.text || "").slice(0, 3000) + " " + d.title).toLowerCase(); const year = +(d.date || d.created || "").slice(0, 4);
  const endOf = n => `${year + n}-12-31`;
  if (ORIGINAL_RE.test(t) || d.doctype === "Zeugnis") return { kind: "original", label: "Original dauerhaft aufheben" };
  if (/renteninformation|rentenversicherung|sozialversicherungsnachweis/.test(t) || d.doctype === "Gehaltsabrechnung")
    return { kind: "original", label: "Bis zur Rente aufheben (Rentennachweis)" };
  if (d.topic === "Steuern" || d.doctype === "Steuerbescheid") return { kind: "until", until: endOf(10), label: "10 Jahre (Steuer)" };
  if (/handwerker|haushaltsnahe|reparatur(?:arbeiten)?|montage/.test(t) && ["Rechnung", "Quittung"].includes(d.doctype))
    return { kind: "until", until: endOf(2), label: "2 Jahre Pflicht (Handwerkerrechnung)" };
  if (d.doctype === "Kontoauszug") return { kind: "until", until: endOf(3), label: "3 Jahre (empfohlen)" };
  if (["Vertrag", "Kündigung"].includes(d.doctype) || d.contractEnd || d.topic === "Versicherungen" || d.topic === "Verträge & Abos") {
    if (d.contractActive === false || d.doctype === "Kündigung") return { kind: "until", until: endOf(3), label: "3 Jahre nach Vertragsende" };
    return { kind: "original", label: "Solange der Vertrag läuft, danach 3 Jahre" };
  }
  const w = warrantyOf(d);
  if (w) { const u = w.until > endOf(3) ? w.until : endOf(3); return { kind: "until", until: u, label: "Bis Garantieende, mind. 3 Jahre" }; }
  if (d.topic === "Gesundheit" && d.doctype === "Befund") return { kind: "original", label: "Befunde dauerhaft aufheben" };
  if (d.topic === "Auto & Mobilität") return { kind: "original", label: "Solange du das Fahrzeug hast" };
  return { kind: "until", until: endOf(3), label: "3 Jahre (regelmäßige Verjährung)" };
}
function viewRetention() {
  header("Aufbewahren", true);
  const keep = [], gone = [], wait = [];
  for (const d of S.docs) {
    const r = retentionInfo(d);
    if (r.kind === "original") keep.push([d, r]); else if (r.kind === "scan" || daysUntil(r.until) < 0) gone.push([d, r]); else wait.push([d, r]);
  }
  wait.sort((a, b) => a[1].until.localeCompare(b[1].until));
  const row = ([d, r]) => `<a class="item" href="#/dok/${d.id}"><div class="meta"><div class="it">${esc(d.title)}</div>
    <div class="is">${esc(r.label)}${r.until ? " · bis " + fmtDate(r.until) : ""}${d.original ? " · liegt in: " + esc(d.original) : ""}</div></div></a>`;
  $("#view").innerHTML = `<p class="small">Faustregeln für Privatleute – keine Rechtsberatung. Der Scan bleibt im Archiv immer erhalten; es geht nur darum, ob das <b>Papier-Original</b> noch gebraucht wird. Im Dokument lässt sich die Einstufung ändern.</p>
    <h2>🗑️ Papier darf weg (${gone.length})</h2>${gone.length ? `<div class="list">${gone.map(row).join("")}</div>` : `<p class="empty">Noch nichts.</p>`}
    <h2>📌 Original aufheben (${keep.length})</h2>${keep.length ? `<div class="list">${keep.map(row).join("")}</div>` : `<p class="empty">–</p>`}
    <h2>⏳ Noch aufbewahren (${wait.length})</h2>${wait.length ? `<div class="list">${wait.map(row).join("")}</div>` : `<p class="empty">–</p>`}`;
}

// ------------------------------------------------------------ Notfall-Mappe
const EMERG_SUGGEST = d => !d.emergency && (d.topic === "Behörden & Ausweise" || (d.topic === "Versicherungen" && ["Vertrag", "Dokument", "Bescheinigung"].includes(d.doctype))
  || (d.topic === "Gesundheit" && d.doctype === "Befund") || /(vollmacht|patientenverfügung|testament|organspende|impfpass|personalausweis|reisepass)/.test((d.text || "").slice(0, 2000).toLowerCase()));
async function viewEmergency() {
  header("Notfall-Mappe", true);
  const inn = S.docs.filter(d => d.emergency), sug = S.docs.filter(EMERG_SUGGEST).slice(0, 15);
  const note = await DB.kvGet("emergencyNote", "");
  $("#view").innerHTML = `<p class="small">Die wichtigsten Unterlagen auf Knopfdruck als ein PDF – für Angehörige, Vorsorge oder den Notfall. Das PDF lässt sich mit einem Passwort schützen.</p>
    <div class="card"><h3>Wichtige Hinweise &amp; Kontakte</h3>
      <textarea class="f" id="em-note" rows="6" placeholder="z. B. Hausarzt Dr. … Tel. …&#10;Versicherungsmakler …&#10;Wo liegt der Ordner mit den Originalen?&#10;Wer hat einen Schlüssel?">${esc(note)}</textarea>
      <button class="btn sec" onclick="saveEmNote()">Hinweise speichern</button></div>
    <h2>In der Mappe (${inn.length})</h2>${inn.length ? `<div class="list">${inn.map(d => `<div class="item"><a class="meta" href="#/dok/${d.id}"><div class="it">${esc(d.title)}</div>
      <div class="is">${esc(topicOf(d.topic).icon)} ${esc(d.topic)}</div></a><button class="mini" onclick="setEmergency(${d.id},false)">Entfernen</button></div>`).join("")}</div>`
      : `<p class="empty">Noch leer – unten Vorschläge übernehmen oder im Dokument „In die Notfall-Mappe“ ankreuzen.</p>`}
    ${sug.length ? `<h2>Vorschläge</h2><div class="list">${sug.map(d => `<div class="item"><a class="meta" href="#/dok/${d.id}"><div class="it">${esc(d.title)}</div>
      <div class="is">${esc(topicOf(d.topic).icon)} ${esc(d.topic)}</div></a><button class="mini" onclick="setEmergency(${d.id},true)">＋ Aufnehmen</button></div>`).join("")}</div>` : ""}
    <button class="btn" ${inn.length || note ? "" : "disabled"} onclick="emergencyPdf()">🆘 Notfall-PDF erstellen</button>`;
}
async function saveEmNote() { await DB.kvSet("emergencyNote", $("#em-note").value); toast("Gespeichert"); }
async function setEmergency(id, on) { const d = await DB.get(id); d.emergency = on; await DB.put(d); await reload(); viewEmergency(); }
async function emergencyPdf() {
  await DB.kvSet("emergencyNote", $("#em-note").value);
  const pw = await passwordSheet("Notfall-PDF schützen", "Mit Passwort lässt sich das PDF nur mit diesem Passwort öffnen. Gib es deinen Angehörigen getrennt vom PDF.", true);
  if (pw === null) return;
  busy("Notfall-PDF wird erstellt …");
  try {
    const docs = S.docs.filter(d => d.emergency).sort((a, b) => a.topic.localeCompare(b.topic));
    const { jsPDF } = window.jspdf;
    const opt = { unit: "mm", format: "a4" };
    if (pw) opt.encryption = { userPassword: pw, ownerPassword: pw + "-owner", userPermissions: ["print"] };
    const pdf = new jsPDF(opt);
    const lat = s => String(s || "").replace(/[^\x20-\x7e -ÿ\n]/g, "");
    pdf.setFontSize(20); pdf.text("Notfall-Mappe", 20, 25);
    pdf.setFontSize(10); pdf.text(`Stand ${new Date().toLocaleDateString("de-DE")}`, 20, 32);
    let y = 45; const note = await DB.kvGet("emergencyNote", "");
    if (note) {
      pdf.setFontSize(13); pdf.text("Wichtige Hinweise & Kontakte", 20, y); y += 8; pdf.setFontSize(11);
      for (const ln of pdf.splitTextToSize(lat(note), 170)) { if (y > 280) { pdf.addPage(); y = 20; } pdf.text(ln, 20, y); y += 5.5; }
      y += 6;
    }
    if (docs.length) {
      if (y > 250) { pdf.addPage(); y = 20; }
      pdf.setFontSize(13); pdf.text("Enthaltene Unterlagen", 20, y); y += 8; pdf.setFontSize(10);
      docs.forEach((d, i) => {
        if (y > 280) { pdf.addPage(); y = 20; }
        pdf.text(lat(`${i + 1}. ${d.title}`).slice(0, 70), 20, y);
        pdf.text(lat(`${d.topic}${d.original ? " - Original: " + d.original : ""}`).slice(0, 60), 115, y); y += 6;
      });
    }
    for (let i = 0; i < docs.length; i++) {
      busy(`Notfall-PDF wird erstellt … ${i + 1} von ${docs.length}`);
      for (const img of await docImages(docs[i])) {
        const h = Math.min(297, 210 * img.h / img.w), ww = h < 297 ? 210 : 297 * img.w / img.h;
        pdf.addPage([210, 297], "p"); pdf.addImage(img.data, "JPEG", (210 - ww) / 2, 0, ww, h);
      }
    }
    const f = new File([pdf.output("blob")], `Notfall-Mappe ${todayIso()}.pdf`, { type: "application/pdf" });
    busy(); await shareFile(f, "Notfall-Mappe");
  } catch (e) { busy(); toast("Fehler: " + e.message); }
}

// ------------------------------------------------------------ Personen
function personBar() {
  if (!S.persons || !S.persons.length) return "";
  return `<div class="seg persons">${["", ...S.persons].map(p => `<button class="${S.person === p ? "on" : ""}" onclick="setPerson('${esc(p).replace(/'/g, "\\'")}')">${p ? "👤 " + esc(p) : "Alle"}</button>`).join("")}</div>`;
}
async function setPerson(p) { await DB.kvSet("person", p); await reload(); route(); }
async function viewPersons() {
  header("Personen", true);
  const counts = {}; S.allDocs.forEach(d => { const p = d.person || S.persons[0] || ""; counts[p] = (counts[p] || 0) + 1; });
  $("#view").innerHTML = `<p class="small">Mit Personen bekommt jeder seinen eigenen Bereich im selben Archiv. Oben auf der Startseite schaltest du um; neue Dokumente gehören zur gerade gewählten Person.</p>
    <div class="list">${S.persons.map((p, i) => `<div class="item"><div class="meta"><div class="it">👤 ${esc(p)}</div><div class="is">${counts[p] || 0} Dokumente${i === 0 ? " · Standard" : ""}</div></div>
      <button class="mini" onclick="renamePerson(${i})">Umbenennen</button>${i > 0 ? `<button class="mini" onclick="delPerson(${i})">Entfernen</button>` : ""}</div>`).join("")}</div>
    <div class="card"><h3>${S.persons.length ? "Weitere Person" : "Personen einrichten"}</h3>
      ${S.persons.length ? "" : `<label>Deine bisherigen Dokumente gehören zu</label><input class="f" id="p-first" placeholder="z. B. Ich">`}
      <label>Neue Person</label><input class="f" id="p-new" placeholder="z. B. Partnerin, Kinder">
      <button class="btn" onclick="addPerson()">Hinzufügen</button></div>`;
}
async function addPerson() {
  const list = [...S.persons];
  if (!list.length) { const f = ($("#p-first").value || "Ich").trim(); list.push(f); }
  const n = $("#p-new").value.trim();
  if (n && !list.includes(n)) list.push(n);
  await DB.kvSet("persons", list); await reload(); toast("Gespeichert"); viewPersons();
}
async function renamePerson(i) {
  const old = S.persons[i];
  sheet(`<h3>Umbenennen</h3><input class="f" id="p-ren" value="${esc(old)}"><button class="btn" id="p-ok">Speichern</button>`);
  $("#p-ok").onclick = async () => {
    const n = $("#p-ren").value.trim(); if (!n) return; closeSheet();
    const list = [...S.persons]; list[i] = n; await DB.kvSet("persons", list);
    for (const d of S.allDocs.filter(d => d.person === old)) { d.person = n; await DB.put(d); }
    if (S.person === old) await DB.kvSet("person", n);
    await reload(); viewPersons();
  };
}
async function delPerson(i) {
  const p = S.persons[i];
  if (!await ask(`„${p}“ entfernen? Die Dokumente kommen zu „${S.persons[0]}“.`, "Entfernen")) return;
  for (const d of S.allDocs.filter(d => d.person === p)) { d.person = S.persons[0]; await DB.put(d); }
  const list = S.persons.filter((_, k) => k !== i); await DB.kvSet("persons", list);
  if (S.person === p) await DB.kvSet("person", "");
  await reload(); viewPersons();
}
