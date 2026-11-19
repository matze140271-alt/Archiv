/* Fotos von Dokumenten: Blatt finden, entzerren, aufhellen. Alles im Browser, ohne Bibliotheken. */
(function (root) {
  "use strict";

  function loadImage(blob) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { res(img); setTimeout(() => URL.revokeObjectURL(url), 1000); };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("Bild konnte nicht gelesen werden")); };
      img.src = url;
    });
  }

  // Bild auf max. Kantenlänge verkleinert in ein Canvas zeichnen (iOS dreht EXIF automatisch)
  function toCanvas(img, maxSide) {
    const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height;
    const sc = Math.min(1, maxSide / Math.max(w0, h0));
    const c = document.createElement("canvas");
    c.width = Math.round(w0 * sc); c.height = Math.round(h0 * sc);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return c;
  }

  function otsu(hist, total) {
    let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sB = 0, wB = 0, best = 0, thr = 127;
    for (let i = 0; i < 256; i++) {
      wB += hist[i]; if (!wB) continue;
      const wF = total - wB; if (!wF) break;
      sB += i * hist[i];
      const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
      if (v > best) { best = v; thr = i; }
    }
    return thr;
  }

  // Findet die vier Ecken des Blattes. Rückgabe in Koordinaten von "canvas" oder null.
  function findCorners(canvas) {
    const S = 360, sc = S / Math.max(canvas.width, canvas.height);
    const w = Math.max(8, Math.round(canvas.width * sc)), h = Math.max(8, Math.round(canvas.height * sc));
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const x = c.getContext("2d", { willReadFrequently: true });
    x.drawImage(canvas, 0, 0, w, h);
    const d = x.getImageData(0, 0, w, h).data;
    const n = w * h, val = new Uint8Array(n), sat = new Uint8Array(n), hist = new Uint32Array(256);
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const r = d[p], g = d[p + 1], b = d[p + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      val[i] = mx; sat[i] = mx ? Math.round((mx - mn) * 255 / mx) : 0; hist[mx]++;
    }
    const thr = otsu(hist, n);
    const candidates = [];
    for (const variant of [0, 1]) {
      const mask = new Uint8Array(n);
      for (let i = 0; i < n; i++) mask[i] = variant === 0 ? (val[i] > thr ? 1 : 0) : (val[i] > Math.max(110, thr - 15) && sat[i] < 60 ? 1 : 0);
      const closed = close(mask, w, h, 4);
      const comp = largestComponent(closed, w, h);
      if (!comp) continue;
      const { pts, area, bx0, by0, bx1, by1 } = comp;
      if (area < 0.15 * n || area > 0.97 * n) continue;
      if (bx1 - bx0 >= w * 0.985 && by1 - by0 >= h * 0.985) continue;     // ganze Fläche = kein Blatt erkennbar
      // Ecken = Extreme von x+y und x-y
      let tl = null, tr = null, br = null, bl = null, a = Infinity, b = -Infinity, cc = -Infinity, dd = Infinity;
      for (let k = 0; k < pts.length; k += 2) {
        const px = pts[k], py = pts[k + 1], s = px + py, df = px - py;
        if (s < a) { a = s; tl = [px, py]; }
        if (s > b) { b = s; br = [px, py]; }
        if (df > cc) { cc = df; tr = [px, py]; }
        if (df < dd) { dd = df; bl = [px, py]; }
      }
      const quad = [tl, tr, br, bl];
      const qa = polyArea(quad);
      if (qa < 0.6 * area) continue;               // keine Viereck-Form
      candidates.push({ quad, score: qa / area + area / n * 0.2 });
    }
    if (!candidates.length) return null;
    candidates.sort((p, q) => q.score - p.score);
    const inv = 1 / sc;
    return candidates[0].quad.map(([px, py]) => [Math.min(canvas.width, px * inv), Math.min(canvas.height, py * inv)]);
  }

  function polyArea(q) {
    let s = 0;
    for (let i = 0; i < 4; i++) { const [x1, y1] = q[i], [x2, y2] = q[(i + 1) % 4]; s += x1 * y2 - x2 * y1; }
    return Math.abs(s) / 2;
  }

  // Morphologisches Schließen (Dilatation, dann Erosion) mit quadratischem Kern
  function close(mask, w, h, r) {
    return erode(dilate(mask, w, h, r), w, h, r);
  }
  function dilate(m, w, h, r) { return morph(m, w, h, r, 1); }
  function erode(m, w, h, r) { return morph(m, w, h, r, 0); }
  function morph(m, w, h, r, isDil) {
    const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let xx = 0; xx < w; xx++) {
        let v = isDil ? 0 : 1;
        for (let k = -r; k <= r; k++) {
          const xk = xx + k; const mv = xk < 0 || xk >= w ? (isDil ? 0 : 1) : m[y * w + xk];
          if (isDil ? mv : !mv) { v = isDil ? 1 : 0; break; }
        }
        tmp[y * w + xx] = v;
      }
    }
    for (let y = 0; y < h; y++) {
      for (let xx = 0; xx < w; xx++) {
        let v = isDil ? 0 : 1;
        for (let k = -r; k <= r; k++) {
          const yk = y + k; const mv = yk < 0 || yk >= h ? (isDil ? 0 : 1) : tmp[yk * w + xx];
          if (isDil ? mv : !mv) { v = isDil ? 1 : 0; break; }
        }
        out[y * w + xx] = v;
      }
    }
    return out;
  }

  function largestComponent(mask, w, h) {
    const lab = new Int32Array(w * h); let best = null, id = 0;
    const stack = new Int32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      if (!mask[i] || lab[i]) continue;
      id++; let sp = 0; stack[sp++] = i; lab[i] = id;
      const pts = []; let bx0 = w, by0 = h, bx1 = 0, by1 = 0;
      while (sp) {
        const j = stack[--sp], jx = j % w, jy = (j - jx) / w;
        pts.push(jx, jy);
        if (jx < bx0) bx0 = jx; if (jx > bx1) bx1 = jx; if (jy < by0) by0 = jy; if (jy > by1) by1 = jy;
        if (jx > 0 && mask[j - 1] && !lab[j - 1]) { lab[j - 1] = id; stack[sp++] = j - 1; }
        if (jx < w - 1 && mask[j + 1] && !lab[j + 1]) { lab[j + 1] = id; stack[sp++] = j + 1; }
        if (jy > 0 && mask[j - w] && !lab[j - w]) { lab[j - w] = id; stack[sp++] = j - w; }
        if (jy < h - 1 && mask[j + w] && !lab[j + w]) { lab[j + w] = id; stack[sp++] = j + w; }
      }
      if (!best || pts.length > best.pts.length) best = { pts, area: pts.length / 2, bx0, by0, bx1, by1 };
    }
    return best;
  }

  // Homographie: bildet Einheitsrechteck (0..W, 0..H) auf das Viereck q ab
  function homography(W, H, q) {
    const src = [[0, 0], [W, 0], [W, H], [0, H]];
    const A = [], B = [];
    for (let i = 0; i < 4; i++) {
      const [x, y] = src[i], [u, v] = q[i];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); B.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); B.push(v);
    }
    const hh = solve(A, B);
    return [...hh, 1];
  }
  function solve(A, b) {
    const n = b.length; const M = A.map((r, i) => [...r, b[i]]);
    for (let c = 0; c < n; c++) {
      let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      [M[c], M[p]] = [M[p], M[c]];
      for (let r = 0; r < n; r++) {
        if (r === c) continue; const f = M[r][c] / M[c][c];
        for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
      }
    }
    return M.map((r, i) => r[n] / r[i]);
  }

  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

  // Entzerrt das Viereck q aus canvas in ein neues Canvas
  function warp(canvas, q, maxSide) {
    let W = Math.max(dist(q[0], q[1]), dist(q[3], q[2])), H = Math.max(dist(q[0], q[3]), dist(q[1], q[2]));
    const sc = Math.min(1, maxSide / Math.max(W, H)); W = Math.round(W * sc); H = Math.round(H * sc);
    const sw = canvas.width, sh = canvas.height;
    const sd = canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, sw, sh).data;
    const out = document.createElement("canvas"); out.width = W; out.height = H;
    const ox = out.getContext("2d"); const od = ox.createImageData(W, H); const o = od.data;
    const m = homography(W, H, q);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const z = m[6] * x + m[7] * y + 1;
        let u = (m[0] * x + m[1] * y + m[2]) / z, v = (m[3] * x + m[4] * y + m[5]) / z;
        if (u < 0) u = 0; if (v < 0) v = 0; if (u > sw - 1.001) u = sw - 1.001; if (v > sh - 1.001) v = sh - 1.001;
        const x0 = u | 0, y0 = v | 0, fx = u - x0, fy = v - y0;
        const p00 = (y0 * sw + x0) * 4, p10 = p00 + 4, p01 = p00 + sw * 4, p11 = p01 + 4;
        const p = (y * W + x) * 4;
        for (let ch = 0; ch < 3; ch++) {
          const a = sd[p00 + ch] + (sd[p10 + ch] - sd[p00 + ch]) * fx;
          const bb = sd[p01 + ch] + (sd[p11 + ch] - sd[p01 + ch]) * fx;
          o[p + ch] = a + (bb - a) * fy;
        }
        o[p + 3] = 255;
      }
    }
    ox.putImageData(od, 0, 0);
    // schmalen Rand abschneiden
    const mx = Math.max(2, Math.round(W * 0.008)), my = Math.max(2, Math.round(H * 0.008));
    const c2 = document.createElement("canvas"); c2.width = W - 2 * mx; c2.height = H - 2 * my;
    c2.getContext("2d").drawImage(out, -mx, -my);
    return c2;
  }

  // Schatten ausgleichen, Hintergrund weiß, Schrift kräftiger. mode: "farbe" | "grau" | "sw"
  function whiten(canvas, mode) {
    const W = canvas.width, H = canvas.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const img = ctx.getImageData(0, 0, W, H); const d = img.data;
    // Hintergrund: stark verkleinert, Maximumfilter (Text raus), weichzeichnen
    const f = 16, bw = Math.max(2, Math.ceil(W / f)), bh = Math.max(2, Math.ceil(H / f));
    const bg = new Float32Array(bw * bh * 3);
    for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
      let mr = 0, mg = 0, mb = 0;
      for (let y = by * f; y < Math.min(H, by * f + f); y += 2) for (let x = bx * f; x < Math.min(W, bx * f + f); x += 2) {
        const p = (y * W + x) * 4; if (d[p] > mr) mr = d[p]; if (d[p + 1] > mg) mg = d[p + 1]; if (d[p + 2] > mb) mb = d[p + 2];
      }
      const q = (by * bw + bx) * 3; bg[q] = mr; bg[q + 1] = mg; bg[q + 2] = mb;
    }
    const blur = boxBlur(boxBlur(bg, bw, bh, 2), bw, bh, 2);
    for (let y = 0; y < H; y++) {
      const gy = Math.min(bh - 1.001, Math.max(0, y / f - 0.5)), y0 = gy | 0, fy = gy - y0;
      for (let x = 0; x < W; x++) {
        const gx = Math.min(bw - 1.001, Math.max(0, x / f - 0.5)), x0 = gx | 0, fx = gx - x0;
        const p = (y * W + x) * 4;
        let gray = 0;
        for (let ch = 0; ch < 3; ch++) {
          const i00 = (y0 * bw + x0) * 3 + ch, i10 = i00 + 3, i01 = i00 + bw * 3, i11 = i01 + 3;
          const b0 = blur[i00] + (blur[i10] - blur[i00]) * fx, b1 = blur[i01] + (blur[i11] - blur[i01]) * fx;
          const b = Math.max(40, b0 + (b1 - b0) * fy);
          let v = d[p + ch] / b * 255;
          v = (v - 30) * (255 / 215);
          v = v < 0 ? 0 : v > 255 ? 255 : v;
          d[p + ch] = v; gray += v;
        }
        if (mode !== "farbe") {
          let g = gray / 3;
          if (mode === "sw") g = g > 165 ? 255 : g < 90 ? 0 : (g - 90) * 3.4;
          d[p] = d[p + 1] = d[p + 2] = g;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }
  function boxBlur(a, w, h, r) {
    const out = new Float32Array(a.length);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let ch = 0; ch < 3; ch++) {
      let s = 0, c = 0;
      for (let k = -r; k <= r; k++) for (let l = -r; l <= r; l++) {
        const yy = y + k, xx = x + l; if (yy < 0 || yy >= h || xx < 0 || xx >= w) continue;
        s += a[(yy * w + xx) * 3 + ch]; c++;
      }
      out[(y * w + x) * 3 + ch] = s / c;
    }
    return out;
  }

  function rotate(canvas, deg) {
    if (!deg) return canvas;
    const c = document.createElement("canvas"); const s = deg % 180 !== 0;
    c.width = s ? canvas.height : canvas.width; c.height = s ? canvas.width : canvas.height;
    const x = c.getContext("2d"); x.translate(c.width / 2, c.height / 2); x.rotate(deg * Math.PI / 180);
    x.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
    return c;
  }

  const toBlob = (canvas, q = 0.82) => new Promise(r => canvas.toBlob(b => r(b), "image/jpeg", q));

  root.Scan = { loadImage, toCanvas, findCorners, warp, whiten, rotate, toBlob };
})(window);
