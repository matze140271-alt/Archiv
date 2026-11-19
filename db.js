/* Lokale Datenbank im iPhone (IndexedDB). */
(function (root) {
  "use strict";
  let dbp = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open("dokumentenarchiv", 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        db.createObjectStore("docs", { keyPath: "id", autoIncrement: true });
        db.createObjectStore("files");          // Schlüssel "id/n" -> Blob
        db.createObjectStore("kv");             // Einstellungen, Themen
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  const done = tx => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = tx.onabort = () => rej(tx.error); });
  const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

  async function all() { const db = await open(); return req(db.transaction("docs").objectStore("docs").getAll()); }
  async function get(id) { const db = await open(); return req(db.transaction("docs").objectStore("docs").get(id)); }
  async function put(doc) { const db = await open(); const tx = db.transaction("docs", "readwrite"); const r = req(tx.objectStore("docs").put(doc)); await done(tx); return r; }
  async function del(id) {
    const db = await open(); const doc = await get(id);
    const tx = db.transaction(["docs", "files"], "readwrite");
    tx.objectStore("docs").delete(id);
    for (let i = 0; i < ((doc && doc.files) || 0); i++) tx.objectStore("files").delete(`${id}/${i}`);
    await done(tx);
  }
  async function putFile(id, n, blob) { const db = await open(); const tx = db.transaction("files", "readwrite"); tx.objectStore("files").put(blob, `${id}/${n}`); await done(tx); }
  async function getFile(id, n) { const db = await open(); return req(db.transaction("files").objectStore("files").get(`${id}/${n}`)); }
  async function delFile(id, n) { const db = await open(); const tx = db.transaction("files", "readwrite"); tx.objectStore("files").delete(`${id}/${n}`); await done(tx); }
  async function kvGet(k, def) { const db = await open(); const v = await req(db.transaction("kv").objectStore("kv").get(k)); return v === undefined ? def : v; }
  async function kvSet(k, v) { const db = await open(); const tx = db.transaction("kv", "readwrite"); tx.objectStore("kv").put(v, k); await done(tx); }
  async function clearAll() {
    const db = await open(); const tx = db.transaction(["docs", "files", "kv"], "readwrite");
    ["docs", "files"].forEach(s => tx.objectStore(s).clear()); await done(tx);
  }
  root.DB = { open, all, get, put, del, putFile, getFile, delFile, kvGet, kvSet, clearAll };
})(window);
