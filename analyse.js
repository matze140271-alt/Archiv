/* Analyse von Dokumenttexten – Thema, Typ, Absender, Datum, Betrag, Fristen.
   Läuft komplett auf dem iPhone. Portiert aus der Home-Assistant-Version. */
(function (root) {
  "use strict";

  const DEFAULT_TOPICS = [
    ["Rechnungen & Kaufbelege", "🧾", "#e07a5f",
      "rechnung, rechnungsnummer, rechnungsbetrag, quittung, kassenbon, kaufbeleg, beleg, bestellung, lieferschein, zahlbar bis, gesamtbetrag, mwst, ust-idnr, umsatzsteuer, artikelnummer, garantie, gewährleistung, amazon, otto, mediamarkt, saturn"],
    ["Versicherungen", "🛡️", "#3d5a80",
      "versicherung, versicherungsschein, police, versicherungsnummer, beitrag, haftpflicht, hausrat, kfz-versicherung, rechtsschutz, berufsunfähigkeit, lebensversicherung, unfallversicherung, schadensmeldung, schadennummer, allianz, huk, ergo, axa, devk, debeka, generali, versicherungsnehmer"],
    ["Bank & Finanzen", "🏦", "#2a9d8f",
      "kontoauszug, iban, bic, sparkasse, volksbank, kredit, darlehen, depot, wertpapier, fonds, dividende, zinsen, überweisung, lastschrift, kreditkarte, girokonto, tagesgeld, bausparvertrag, commerzbank, deutsche bank, ing, dkb, comdirect, sparplan, kontostand"],
    ["Steuern", "📊", "#6d597a",
      "finanzamt, steuerbescheid, einkommensteuer, steuererklärung, steuernummer, steuer-id, identifikationsnummer, lohnsteuerbescheinigung, elster, grundsteuer, kfz-steuer, steuerberater, veranlagung, erstattung, nachzahlung"],
    ["Gesundheit", "🩺", "#e63946",
      "arzt, praxis, krankenkasse, aok, tk, techniker krankenkasse, barmer, dak, ikk, befund, rezept, attest, arbeitsunfähigkeit, krankenhaus, klinik, apotheke, zahnarzt, heil- und kostenplan, diagnose, behandlung, patient, physiotherapie, impf"],
    ["Auto & Mobilität", "🚗", "#f4a261",
      "fahrzeug, kennzeichen, zulassung, fahrzeugschein, zulassungsbescheinigung, tüv, hauptuntersuchung, werkstatt, inspektion, reifen, autohaus, leasing, kfz, fahrgestellnummer, ladekarte, wallbox, volkswagen, vw, cupra, seat, bußgeld, tankstelle, adac"],
    ["Wohnen & Energie", "🏠", "#588157",
      "miete, mietvertrag, vermieter, nebenkosten, nebenkostenabrechnung, betriebskosten, strom, gas, wasser, stadtwerke, abschlag, zählerstand, jahresabrechnung, octopus, energie, kwh, photovoltaik, grundbesitz, hausverwaltung, müll, abwasser, schornsteinfeger, handwerker, rundfunkbeitrag"],
    ["Arbeit & Gehalt", "💼", "#264653",
      "arbeitgeber, arbeitsvertrag, gehaltsabrechnung, lohnabrechnung, entgeltabrechnung, gehalt, lohn, brutto, netto, urlaubsantrag, arbeitszeugnis, kündigung des arbeitsverhältnisses, sozialversicherung, rentenversicherung, deutsche rentenversicherung, renteninformation, bewerbung"],
    ["Verträge & Abos", "📝", "#8d99ae",
      "vertrag, vertragsnummer, kundennummer, laufzeit, kündigung, kündigungsbestätigung, vertragsbestätigung, mitgliedschaft, abonnement, abo, mobilfunk, telekom, vodafone, o2, 1&1, internet, dsl, glasfaser, tarif, netflix, spotify, fitnessstudio, vertragsänderung"],
    ["Behörden & Ausweise", "🏛️", "#457b9d",
      "stadt, gemeinde, landratsamt, bürgeramt, meldebescheinigung, personalausweis, reisepass, geburtsurkunde, heiratsurkunde, standesamt, bescheid, amt, behörde, aktenzeichen, rundfunk, familienkasse, kindergeld, elterngeld, jobcenter, agentur für arbeit, führerschein"],
    ["Schule & Ausbildung", "🎓", "#ffb703",
      "schule, zeugnis, abschlusszeugnis, universität, hochschule, studium, immatrikulation, ausbildung, kurs, zertifikat, teilnahmebescheinigung, prüfung, kita, kindergarten, elternbrief"],
    ["Garantie & Anleitungen", "🔧", "#7f5539",
      "bedienungsanleitung, gebrauchsanweisung, handbuch, garantieschein, garantiekarte, seriennummer, modellnummer, sicherheitshinweise, installation, montageanleitung"],
    ["Sonstiges", "📁", "#adb5bd", ""],
  ].map(([name, icon, color, keywords]) => ({ name, icon, color, keywords }));

  const FALLBACK = "Sonstiges";
  const GENERIC = new Set(["Rechnungen & Kaufbelege"]);

  const KNOWN_SENDERS = {
    "Versicherungen": ["debeka", "allianz", "huk-coburg", "huk24", "huk ", "ergo", "axa", "devk", "generali", "lvm", "hdi",
      "r+v", "signal iduna", "hansemerkur", "gothaer", "provinzial", "württembergische", "vhv", "cosmosdirekt", "barmenia",
      "continentale", "nürnberger versicherung", "zurich", "alte leipziger", "versicherungsverein", "versicherungs-ag",
      "versicherung ag", "volkswohl bund", "arag"],
    "Gesundheit": ["aok", "techniker krankenkasse", "barmer", "dak-gesundheit", "ikk", "bkk", "klinikum", "praxis dr",
      "zahnarztpraxis", "apotheke", "krankenhaus"],
    "Bank & Finanzen": ["sparkasse", "volksbank", "raiffeisenbank", "commerzbank", "deutsche bank", "ing-diba", "dkb",
      "comdirect", "consorsbank", "postbank", "santander", "targobank", "trade republic", "scalable capital", "paypal",
      "union investment", "deka"],
    "Steuern": ["finanzamt"],
    "Wohnen & Energie": ["octopus energy", "stadtwerke", "e.on", "vattenfall", "eprimo", "yello", "rheinenergie"],
    "Verträge & Abos": ["telekom deutschland", "vodafone", "telefónica", "1&1", "congstar", "netflix", "spotify", "sky deutschland"],
    "Auto & Mobilität": ["volkswagen", "cupra", "autohaus", "tüv nord", "tüv süd", "dekra", "adac"],
    "Behörden & Ausweise": ["bürgeramt", "landratsamt", "bundesagentur", "familienkasse"],
    "Arbeit & Gehalt": ["deutsche rentenversicherung"],
  };

  const DOCTYPES = [
    ["Mahnung", ["mahnung", "zahlungserinnerung", "letzte erinnerung"]],
    ["Rechnung", ["rechnung", "rechnungsnummer", "invoice"]],
    ["Kontoauszug", ["kontoauszug"]],
    ["Gehaltsabrechnung", ["gehaltsabrechnung", "lohnabrechnung", "entgeltabrechnung"]],
    ["Steuerbescheid", ["steuerbescheid", "einkommensteuerbescheid", "bescheid für"]],
    ["Bescheid", ["bescheid"]],
    ["Kündigung", ["kündigungsbestätigung", "hiermit kündige", "ihre kündigung", "kündigung zum", "kündigung ihres",
      "kündigung des", "kündigung meines", "kündigungsschreiben"]],
    ["Vertrag", ["vertragsbestätigung", "auftragsbestätigung", "vertrag", "vereinbarung", "versicherungsschein", "police"]],
    ["Angebot", ["angebot", "kostenvoranschlag"]],
    ["Quittung", ["quittung", "kassenbon", "bon-nr", "beleg-nr"]],
    ["Zeugnis", ["zeugnis"]],
    ["Befund", ["befund", "arztbrief"]],
    ["Anleitung", ["bedienungsanleitung", "gebrauchsanweisung"]],
    ["Bescheinigung", ["bescheinigung"]],
    ["Bestätigung", ["bestätigung"]],
  ];

  const MONTHS = { januar: 1, jan: 1, februar: 2, feb: 2, "märz": 3, maerz: 3, "mär": 3, april: 4, apr: 4, mai: 5,
    juni: 6, jun: 6, juli: 7, jul: 7, august: 8, aug: 8, september: 9, sep: 9, sept: 9, oktober: 10, okt: 10,
    november: 11, nov: 11, dezember: 12, dez: 12 };

  const STOP = new Set(("der die das und oder ein eine einer eines einem einen ist sind war wird werden wurde für fur " +
    "mit von vom zu zum zur im in an am auf aus bei bis nach über unter durch gegen ohne um sie ihr ihre ihnen wir uns " +
    "unser unsere ich mich mir du dich dir es er sein seine nicht auch als wie so dass daß sehr geehrte geehrter herr frau " +
    "damen herren freundlichen grüßen grüssen seite bitte vielen dank hiermit wenn dann noch nur schon kann können haben " +
    "hat hatten diese dieser dieses alle allen www de com tel fax email e-mail str straße strasse nr datum").split(" "));

  const ORG_HINT = /(^|[^a-zäöüß])(gmbh|ag|kg|ohg|e\.\s?v\.|se|ug|mbh|versicherung\w*|\w*versicherung\w*|a\.\s?g\.|bank|sparkasse|volksbank|finanzamt|stadtwerke|krankenkasse|aok|barmer|praxis|klinik\w*|stadt|gemeinde|landratsamt|amt|rentenversicherung|telekom|vodafone|autohaus)(?![a-zäöüß])/i;

  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const norm = t => " " + (t || "").toLowerCase().replace(/\s+/g, " ") + " ";
  const wordStart = kw => new RegExp("(?<![a-zäöüß])" + esc(kw), "g");

  function tokenize(text) {
    const w = (text || "").toLowerCase().match(/[a-zäöüß][a-zäöüß\-]{2,}/g) || [];
    return w.filter(x => !STOP.has(x) && x.length <= 30);
  }

  // ------------------------------------------------ lernendes Modell (Naive Bayes)
  class Model {
    constructor(samples) {
      this.wc = {}; this.dc = {}; this.tw = {}; const vocab = new Set();
      for (const [topic, text] of samples) {
        const toks = tokenize(text).slice(0, 3000);
        const c = this.wc[topic] || (this.wc[topic] = new Map());
        for (const t of toks) { c.set(t, (c.get(t) || 0) + 1); vocab.add(t); }
        this.dc[topic] = (this.dc[topic] || 0) + 1;
        this.tw[topic] = (this.tw[topic] || 0) + toks.length;
      }
      this.v = Math.max(vocab.size, 1);
      this.n = Object.values(this.dc).reduce((a, b) => a + b, 0);
    }
    probs(text) {
      if (this.n < 5 || Object.keys(this.dc).length < 2) return {};
      const toks = tokenize(text).slice(0, 3000); if (!toks.length) return {};
      const lp = {};
      for (const [topic, n] of Object.entries(this.dc)) {
        let p = Math.log(n / this.n); const wc = this.wc[topic]; const den = this.tw[topic] + this.v;
        for (const t of toks) p += Math.log(((wc.get(t) || 0) + 1) / den);
        lp[topic] = p;
      }
      const m = Math.max(...Object.values(lp)); let s = 0; const e = {};
      for (const k in lp) { e[k] = Math.exp(lp[k] - m); s += e[k]; }
      for (const k in e) e[k] /= s;
      return e;
    }
  }

  // ------------------------------------------------ Thema
  function classifyTopic(text, topics, model) {
    const t = norm(text), head = norm((text || "").slice(0, 700));
    const scores = {};
    for (const tp of topics) {
      const kws = (tp.keywords || "").split(",").map(k => k.trim().toLowerCase()).filter(Boolean);
      let s = 0;
      for (const kw of kws) {
        const hits = (t.match(wordStart(kw)) || []).length;
        if (hits) s += (kw.includes(" ") || kw.includes("-") ? 2 : 1) + Math.min(hits - 1, 3) * 0.25;
        else if (kw.length >= 9 && /^[a-zäöüß]+$/.test(kw) && t.includes(kw)) s += 0.5;
        if (wordStart(kw).test(head)) s += 1;
      }
      scores[tp.name] = s;
    }
    for (const [name, brands] of Object.entries(KNOWN_SENDERS))
      if (name in scores && brands.some(b => head.includes(b))) scores[name] += 4;
    if (model) {
      const w = 4 * Math.min(1, model.n / 80);
      for (const [name, p] of Object.entries(model.probs(text))) if (name in scores) scores[name] += w * p;
    }
    let best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0] || [FALLBACK, 0];
    if (GENERIC.has(best[0])) {
      const others = Object.entries(scores).filter(([k]) => !GENERIC.has(k) && k !== FALLBACK).sort((a, b) => b[1] - a[1]);
      if (others.length && others[0][1] >= 2 && others[0][1] >= 0.5 * best[1]) best = others[0];
    }
    if (best[1] < 1) {
      const names = topics.map(x => x.name);
      return [names.includes(FALLBACK) ? FALLBACK : (names[names.length - 1] || FALLBACK), scores];
    }
    return [best[0], scores];
  }

  function detectDoctype(text) {
    // der Begriff, der zuerst im Text steht, gewinnt (Betreffzeile vor Fließtext)
    const t = norm((text || "").slice(0, 4000));
    let best = null;
    DOCTYPES.forEach(([name, kws], prio) => {
      for (const kw of kws) {
        const m = wordStart(kw).exec(t);
        if (m && (!best || m.index < best[0] || (m.index === best[0] && prio < best[1]))) best = [m.index, prio, name];
      }
    });
    return best ? best[2] : "Dokument";
  }

  const today = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  function mk(y, m, d) {
    const dt = new Date(y, m - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
    return dt;
  }
  function valid(y, m, d) {
    const dt = mk(y, m, d);
    return dt && y >= 1950 && y <= today().getFullYear() + 1 ? dt : null;
  }

  function detectDate(text) {
    const head = (text || "").slice(0, 5000); const found = [];
    const yy = today().getFullYear() % 100;
    const push = (m, dt) => dt && found.push([m.index, dt, head.slice(Math.max(0, m.index - 25), m.index).toLowerCase()]);
    for (const m of head.matchAll(/\b(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4}|\d{2})\b/g)) {
      let y = +m[3]; if (y < 100) y += y <= yy + 1 ? 2000 : 1900;
      push(m, valid(y, +m[2], +m[1]));
    }
    for (const m of head.matchAll(/\b(\d{1,2})\.\s?([A-Za-zäÄ]{3,9})\.?\s(\d{4})\b/g)) {
      const mo = MONTHS[m[2].toLowerCase()]; if (mo) push(m, valid(+m[3], mo, +m[1]));
    }
    for (const m of head.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) push(m, valid(+m[1], +m[2], +m[3]));
    if (!found.length) return null;
    const t0 = today();
    for (const [, dt, before] of found)
      if (/(datum|den|vom|ausgestellt|rechnungsdatum|belegdatum)[:\s]*$/.test(before) && dt <= t0) return iso(dt);
    for (const [, dt, before] of found.sort((a, b) => a[0] - b[0]))
      if (dt <= t0 && !before.includes("geb")) return iso(dt);
    return null;   // nur Daten in der Zukunft (Fristen, Laufzeiten) – kein Dokumentdatum
  }

  function detectAmount(text) {
    let best = null;
    const flat = (text || "").replace(/[ \t ]+/g, " ");
    const re = /(gesamtbetrag|rechnungsbetrag|endbetrag|gesamtsumme|summe|zu zahlen|zahlbetrag|jahresbeitrag|beitrag|erstattung|nachzahlung|betrag|total)[^\d\n]{0,40}?(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})\s?(€|eur)?/gi;
    for (const m of flat.matchAll(re)) {
      const val = parseFloat(m[2].replace(/\./g, "").replace(",", "."));
      const prio = /^(gesamt|rechnungs|end|zu zahlen|zahl)/i.test(m[1]) ? 2 : 1;
      if (!best || prio > best[0] || (prio === best[0] && val > best[1])) best = [prio, val];
    }
    return best ? Math.round(best[1] * 100) / 100 : null;
  }

  function detectSender(text) {
    let lines = (text || "").split(/\r?\n/).map(l => l.trim().replace(/^[ |•*\-–_]+|[ |•*\-–_]+$/g, ""));
    lines = lines.filter(l => l.length >= 3 && l.length <= 80);
    const brands = Object.values(KNOWN_SENDERS).flat().map(b => b.trim());
    for (const l of lines.slice(0, 12))
      if (!/\d{5}|@|www/i.test(l) && brands.some(b => l.toLowerCase().includes(b))) return l.replace(/\s{2,}/g, " ").slice(0, 60);
    for (const l0 of lines.slice(0, 25)) {
      if (/(nummer|nr\.|datum|seite)/i.test(l0)) continue;
      if (ORG_HINT.test(l0) && !/\d{5}/.test(l0) && !l0.includes("@") && !/www/i.test(l0)) {
        let l = l0.replace(/\s{2,}/g, " ");
        l = l.split(/\s[·|,]\s|\s-\s/)[0];
        return l.slice(0, 60);
      }
    }
    for (const l of lines.slice(0, 3))
      if (!/\d/.test(l) && l.length <= 45 && /^[A-ZÄÖÜ]/.test(l) && !/^(herr|frau|sehr|seite|an |betreff)/i.test(l)) return l;
    return "";
  }

  function makeTitle(doctype, sender, topic, text) {
    if (sender) return doctype !== "Dokument" ? `${doctype} ${sender}` : sender;
    if (doctype !== "Dokument") return doctype;
    for (let l of (text || "").split(/\r?\n/)) {
      l = l.trim();
      if (l.length >= 6 && l.length <= 60 && [...l].filter(c => /[a-zäöüß]/i.test(c)).length > l.length * 0.6) return l;
    }
    return topic;
  }

  function suggestTags(text, doctype) {
    const tags = new Set(); const t = (text || "").toLowerCase();
    if (doctype !== "Dokument") tags.add(doctype.toLowerCase());
    for (const [kw, tag] of [["kündigung", "kündigung"], ["garantie", "garantie"], ["steuer", "steuerrelevant"],
      ["mahnung", "mahnung"], ["frist", "frist"], ["zahlbar bis", "offen"]]) if (t.includes(kw)) tags.add(tag);
    return [...tags].sort().join(", ");
  }

  // ------------------------------------------------ Fristen
  const DATE_RE = "(\\d{1,2}\\.\\s?\\d{1,2}\\.\\s?\\d{2,4}|\\d{1,2}\\.\\s?[A-Za-zäÄ]{3,9}\\.?\\s\\d{4}|\\d{4}-\\d{2}-\\d{2})";
  function parseDate(s) {
    s = (s || "").trim(); let m;
    if ((m = s.match(/^(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{2,4})$/))) { let y = +m[3]; if (y < 100) y += 2000; return mk(y, +m[2], +m[1]); }
    if ((m = s.match(/^(\d{1,2})\.\s?([A-Za-zäÄ]{3,9})\.?\s(\d{4})$/)) && MONTHS[m[2].toLowerCase()]) return mk(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
    if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) return mk(+m[1], +m[2], +m[3]);
    return null;
  }
  function addMonths(d, n) {
    const y = d.getFullYear(), m = d.getMonth() + n;
    const last = new Date(y, m + 1, 0).getDate();
    return new Date(y, m, Math.min(d.getDate(), last));
  }
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const num = s => parseFloat(s.replace(/\./g, "").replace(",", "."));

  function detectExtras(text, doctype, topic, docDate) {
    const tl = (text || "").replace(/[ \t ]+/g, " ").toLowerCase();
    const dd = docDate ? parseDate(docDate) : null;
    const out = { dueDate: null, paid: null, warrantyUntil: null, contractEnd: null, noticePeriod: "", cancelBy: null,
      costAmount: null, costInterval: "", taxRelevant: false, iban: "" };
    let m = tl.match(new RegExp("(zahlbar bis(?: zum)?|fällig (?:am|bis|zum)|zahlungsziel[:\\s]*|bitte bis (?:zum )?|spätestens (?:am|bis zum)|f[äa]lligkeit(?:sdatum)?[:\\s]*|zu zahlen bis(?: zum)?)\\s*" + DATE_RE));
    if (m) { const d = parseDate(m[2]); if (d) out.dueDate = iso(d); }
    if (!out.dueDate && dd) {
      m = tl.match(/(zahlbar|zahlung|überweisung|begleichen)[^.\n]{0,40}?innerhalb (?:von )?(\d{1,3}) tag/);
      if (m) out.dueDate = iso(addDays(dd, +m[2]));
    }
    if (doctype === "Rechnung" || doctype === "Mahnung" || out.dueDate) {
      if (/(lastschrift|abgebucht|wird von ihrem konto|bereits bezahlt|betrag (?:dankend )?erhalten|bezahlt mit|zahlungsart: ?(?:paypal|kreditkarte|ec|girocard|bar)|bar bezahlt)/.test(tl)) out.paid = true;
      else if (out.dueDate || doctype === "Mahnung" || /(bitte überweisen|überweisen sie|zahlbar)/.test(tl)) out.paid = false;
    }
    if (doctype === "Quittung") out.paid = true;
    m = tl.match(/(garantie|gewährleistung|herstellergarantie)[^.\n]{0,30}?(\d{1,2})\s*(jahr|monat)/);
    if (m && dd) out.warrantyUntil = iso(addMonths(dd, m[3] === "jahr" ? +m[2] * 12 : +m[2]));
    m = tl.match(new RegExp("garantie (?:gültig )?bis(?: zum)?\\s*" + DATE_RE));
    if (m) { const d = parseDate(m[1]); if (d) out.warrantyUntil = iso(d); }
    m = tl.match(/kündigungsfrist(?: beträgt| von|:)?\s*(\d+)\s*(monat|woche|tag)/);
    let months = null;
    if (m) {
      const n = +m[1]; const u = { monat: ["Monat", "Monate"], woche: ["Woche", "Wochen"], tag: ["Tag", "Tage"] }[m[2]];
      out.noticePeriod = `${n} ${n === 1 ? u[0] : u[1]}`;
      months = { monat: n, woche: n / 4.345, tag: n / 30.4 }[m[2]];
    }
    m = tl.match(new RegExp("(laufzeit bis|vertragsende[:\\s]*|endet am|mindestlaufzeit bis|befristet bis|gültig bis|vertrag läuft bis)\\s*(?:zum )?" + DATE_RE));
    if (m) { const d = parseDate(m[2]); if (d) out.contractEnd = iso(d); }
    if (out.contractEnd && months) {
      const ce = parseDate(out.contractEnd);
      out.cancelBy = iso(Number.isInteger(months) ? addMonths(ce, -months) : addDays(ce, -Math.round(months * 30.44)));
    }
    m = tl.match(/(monatlich(?:er beitrag| beitrag)?|monatsbeitrag|mtl\.|pro monat|\/ ?monat|je monat|grundgebühr)[^\d\n]{0,25}?(\d{1,4}(?:\.\d{3})*,\d{2})/)
      || tl.match(/(\d{1,4}(?:\.\d{3})*,\d{2})\s?(?:€|eur)\s?(?:\/|pro|je)\s?monat/);
    if (m) { out.costAmount = num(m[m.length - 1]); out.costInterval = "monatlich"; }
    else if ((m = tl.match(/(jährlich|jahresbeitrag|pro jahr|\/ ?jahr|jahresprämie)[^\d\n]{0,25}?(\d{1,5}(?:\.\d{3})*,\d{2})/))) { out.costAmount = num(m[2]); out.costInterval = "jährlich"; }
    if (topic === "Steuern" || topic === "Arbeit & Gehalt" || /(?<![a-zäöüß])(steuer|lohnsteuer|spendenbescheinigung|zuwendungsbestätigung|handwerkerleistung|haushaltsnahe|nebenkostenabrechnung|riester|rürup|kirchensteuer|werbungskosten)/.test(tl)) out.taxRelevant = true;
    Object.assign(out, detectPayment(text));
    return out;
  }

  // ------------------------------------------------ Zahlungsdaten fuer GiroCode
  function ibanOk(iban) {
    iban = (iban || "").replace(/\s/g, "").toUpperCase();
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
    if (iban.startsWith("DE") && iban.length !== 22) return false;
    const s = iban.slice(4) + iban.slice(0, 4);
    let r = 0;
    for (const c of s) { const v = parseInt(c, 36); r = (r * (v > 9 ? 100 : 10) + v) % 97; }
    return r === 1;
  }
  function detectPayment(text) {
    const t = (text || "").replace(/[ \t\u00a0]+/g, " "), tl = t.toLowerCase();
    const out = { iban: "", bic: "", payName: "", payRef: "" };
    const cands = [];
    for (const m of t.matchAll(/\b([A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,3})?)\b/g)) {
      const raw = m[1].replace(/ /g, "");
      for (const ln of [22, raw.length]) {
        const c = raw.slice(0, ln);
        if (ibanOk(c)) {
          const ctx = tl.slice(Math.max(0, m.index - 160), m.index); let score = 0;
          if (/(empfänger|bankverbindung|zahlbar|überweis|bitte zahlen|konto(?:verbindung)?:|zugunsten|auf das konto|auf unser konto)/.test(ctx)) score += 2;
          if (/(ihr konto|ihre iban|von folgender bankverbindung|abgebucht|lastschrift|ihrem konto|deinem konto)/.test(ctx)) score -= 3;
          cands.push([score, m.index, c, m.index + m[0].length]); break;
        }
      }
    }
    if (cands.length) {
      cands.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
      const [, pos, iban, end] = cands[0]; out.iban = iban;
      const near = t.slice(Math.max(0, pos - 200), end + 120);
      const b = near.match(/\bBIC[:\s]*([A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?)\b/); if (b) out.bic = b[1];
      const n = near.match(/(?:empfänger|kontoinhaber|zahlungsempfänger)[:\s]+([^\n]{3,60})/i); if (n) out.payName = n[1].trim().replace(/^:|:$/g, "").slice(0, 70);
    }
    for (const re of [/verwendungszweck[:\s]+([^\n]{3,60})/i, /rechnungs?-? ?(?:nummer|nr\.?)[:\s]*([A-Z0-9][A-Z0-9\-\/ ]{2,30}[A-Z0-9])/i,
      /(?:kunden|kund\*innen)-? ?(?:nummer|nr\.?)[:\s]*([A-Z0-9][A-Z0-9\-\/ ]{2,30}[A-Z0-9])/i]) {
      const m = t.match(re);
      if (m) { const ref = m[1].trim().split(/\s{2,}/)[0]; if (/\d/.test(ref)) { out.payRef = ref.slice(0, 60); break; } }
    }
    return out;
  }
  function epcPayload(name, iban, bic, amount, ref) {
    const lines = ["BCD", "002", "1", "SCT", (bic || "").trim(), (name || "Empfänger").slice(0, 70),
      (iban || "").replace(/\s/g, "").toUpperCase(), amount ? "EUR" + Number(amount).toFixed(2) : "", "", "", (ref || "").slice(0, 140)];
    return lines.join("\n").replace(/\n+$/, "");
  }

  function analyze(text, topics, model) {
    const [topic, scores] = classifyTopic(text, topics, model);
    const doctype = detectDoctype(text), sender = detectSender(text), date = detectDate(text);
    return Object.assign({ topic, doctype, sender, date, amount: detectAmount(text),
      title: makeTitle(doctype, sender, topic, text), tags: suggestTags(text, doctype), scores },
      detectExtras(text, doctype, topic, date));
  }

  root.Analyse = { DEFAULT_TOPICS, Model, analyze, tokenize, classifyTopic, parseDate, iso, addMonths, addDays, ibanOk, epcPayload, detectPayment };
})(typeof window !== "undefined" ? window : globalThis);
