// ── prymo ToolBox — client-side processing engine (WebAssembly) ──────────
// Everything in this file runs 100% inside the browser: no server, no paid
// APIs.  It powers all image tools and most PDF tools so the site works as a
// purely static deployment (e.g. Netlify free tier).

export const isImageFile = (f) => /^image\//.test(f.type || '') || /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(f.name);
export const isPdfFile = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);

const extOfName = (n) => {
  const m = /\.([a-z0-9]+)$/i.exec(n || '');
  return m ? m[1].toLowerCase() : '';
};
const baseOf = (n) => (n || 'file').replace(/\.[^.]+$/, '').replace(/[^\w.-]/g, '_');

/* ============================================================ image decode */
async function decodeImage(file) {
  const ext = extOfName(file.name);
  // Try native browser decoders first (fast path; also handles animated GIFs)
  if (ext !== 'tif' && ext !== 'tiff') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { bitmap: bmp, width: bmp.width, height: bmp.height };
    } catch { /* fall through to wasm decoders */ }
  }
  if (ext === 'png' || file.type === 'image/png') {
    const { decode } = await import('@jsquash/png');
    const img = await decode(await file.arrayBuffer());
    return { imageData: img, width: img.width, height: img.height };
  }
  if (ext === 'webp' || file.type === 'image/webp') {
    const { decode } = await import('@jsquash/webp');
    const img = await decode(await file.arrayBuffer());
    return { imageData: img, width: img.width, height: img.height };
  }
  if (ext === 'tif' || ext === 'tiff') throw new Error('TIFF not supported in the browser — use the desktop backend');
  const { decode } = await import('@jsquash/jpeg');
  const img = await decode(await file.arrayBuffer(), { useTArray: true });
  return { imageData: img, width: img.width, height: img.height };
}

let _ctx2d = null;
function ctx2d(w, h) {
  if (!_ctx2d) { const c = document.createElement('canvas'); _ctx2d = c.getContext('2d'); }
  _ctx2d.canvas.width = Math.max(1, w); _ctx2d.canvas.height = Math.max(1, h);
  return _ctx2d;
}

/** Draw decoded source onto a fresh canvas at target size (contain/cover/fill/inside). */
function paintTo(decoded, w, h, fit = 'fill') {
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(w)); out.height = Math.max(1, Math.round(h));
  const g = out.getContext('2d');
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  const sw = decoded.width, sh = decoded.height;
  let dx = 0, dy = 0, dw = out.width, dh = out.height;
  if (fit === 'inside' || fit === 'contain') {
    const s = Math.min(out.width / sw, out.height / sh);
    dw = Math.round(sw * s); dh = Math.round(sh * s);
    dx = Math.round((out.width - dw) / 2); dy = Math.round((out.height - dh) / 2);
  } else if (fit === 'cover') {
    const s = Math.max(out.width / sw, out.height / sh);
    dw = Math.round(sw * s); dh = Math.round(sh * s);
    dx = Math.round((out.width - dw) / 2); dy = Math.round((out.height - dh) / 2);
  }
  const src = decoded.bitmap ?? (() => { const c = document.createElement('canvas'); c.width = sw; c.height = sh; c.getContext('2d').putImageData(decoded.imageData, 0, 0); return c; })();
  g.drawImage(src, dx, dy, dw, dh);
  return out;
}

/* ============================================================ image encode */
async function encodeCanvas(canvas, fmt, quality = 85) {
  const q = Math.max(0.05, Math.min(1, quality / 100));
  if (fmt === 'jpg' || fmt === 'jpeg') {
    const { encode } = await import('@jsquash/jpeg');
    const g = canvas.getContext('2d');
    const data = g.getImageData(0, 0, canvas.width, canvas.height);
    const buf = await encode(data, { quality: q });
    return { blob: new Blob([buf], { type: 'image/jpeg' }), ext: 'jpg' };
  }
  if (fmt === 'webp') {
    const { encode } = await import('@jsquash/webp');
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    const buf = await encode(data, { quality: q });
    return { blob: new Blob([buf], { type: 'image/webp' }), ext: 'webp' };
  }
  if (fmt === 'png') {
    try {
      const { encode } = await import('@jsquash/png');
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
      const buf = await encode(data);
      return { blob: new Blob([buf], { type: 'image/png' }), ext: 'png' };
    } catch {
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
      return { blob, ext: 'png' };
    }
  }
  const blob = await new Promise((r) => canvas.toBlob(r, `image/${fmt}`, q));
  return { blob, ext: fmt };
}

/** Encode with optional DPI stamping via Canvasify metadata (best effort: PNG pHYs / JPEG density ignored client-side). */
async function encodeWithDpi(canvas, fmt, quality, dpi) {
  const r = await encodeCanvas(canvas, fmt, quality);
  if (dpi && fmt === 'png') {
    try { r.blob = await stampPngPpi(r.blob, dpi); } catch { /* keep unstamped */ }
  }
  return r;
}

/** Insert/replace a pHYs chunk (pixels-per-metre) in a PNG blob. */
async function stampPngPpi(blob, ppi) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const ppm = Math.round(ppi * 39.3701);
  const body = bytes.subarray(8, bytes.length - 12); // strip sig + IEND
  const chunks = [];
  let i = 0;
  while (i < body.length) {
    const len = (body[i] << 24 | body[i + 1] << 16 | body[i + 2] << 8 | body[i + 3]) >>> 0;
    const type = String.fromCharCode(body[i + 4], body[i + 5], body[i + 6], body[i + 7]);
    const chunk = body.subarray(i, i + 12 + len);
    if (type !== 'pHYs') chunks.push(chunk);
    i += 12 + len;
  }
  const payload = new Uint8Array(9);
  const dv = new DataView(payload.buffer);
  dv.setUint32(0, ppm); dv.setUint32(4, ppm); payload[8] = 1; // unit=meter
  const crcTable = stampPngPpi._crc || (stampPngPpi._crc = makeCrcTable());
  const typeBytes = [0x70, 0x48, 0x59, 0x73]; // 'pHYs'
  const crcInput = new Uint8Array(4 + payload.length);
  crcInput.set(typeBytes, 0); crcInput.set(payload, 4);
  const crc = crc32(crcTable, crcInput);
  const head = new Uint8Array(8);
  const hv = new DataView(head.buffer);
  hv.setUint32(0, payload.length); head.set(typeBytes, 4);
  const tail = new Uint8Array(4); new DataView(tail.buffer).setUint32(0, crc >>> 0);
  const total = 8 + head.length + payload.length + tail.length + 12 + body.length;
  const out = new Uint8Array(total);
  let o = 0;
  out.set(bytes.subarray(0, 8), 0); o = 8;               // signature
  for (const c of chunks) { out.set(c, o); o += c.length; }
  out.set(head, o); o += head.length;
  out.set(payload, o); o += payload.length;
  out.set(tail, o); o += tail.length;
  const iend = new Uint8Array(12);
  new DataView(iend.buffer).setUint32(0, 0);
  iend.set([0x49, 0x45, 0x4e, 0x44], 4);
  new DataView(iend.buffer).setUint32(8, 0xae426082);
  out.set(iend, o);
  return new Blob([out], { type: 'image/png' });
}
function makeCrcTable() {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
}
function crc32(table, buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* ============================================================ compress (hero) */
/**
 * Granular image compression, fully client-side.
 * quality 1-100 · maxW/maxH px · targetKB (binary-search on quality + iterative downscale)
 * dpi (PNG pHYs / jpeg-webp best-effort) · fmt conversion · strip metadata (always, re-encoded from pixels)
 */
export async function compressImage(file, opts) {
  const { quality = 80, maxW = 0, maxH = 0, targetKB = 0, dpi = 0, fmt = '', } = opts;
  const decoded = await decodeImage(file);
  const srcFmt = ({ png: 'png', jpg: 'jpg', jpeg: 'jpg', webp: 'webp', gif: 'gif', bmp: 'png' })[extOfName(file.name)] || 'jpg';
  const outFmt = fmt || srcFmt;
  let w = decoded.width, h = decoded.height;
  if (maxW || maxH) {
    const ratio = Math.min((maxW || w) / w, (maxH || h) / h, 1);
    if (ratio < 1) { w = Math.max(1, Math.round(w * ratio)); h = Math.max(1, Math.round(h * ratio)); }
  }
  const render = async (q, ww, hh) => {
    const canvas = paintTo(decoded, ww, hh, 'fill');
    const { blob } = await encodeCanvas(canvas, outFmt === 'gif' ? 'png' : outFmt, q);
    return blob;
  };
  let best = await render(quality, w, h);
  const targetBytes = targetKB > 0 ? targetKB * 1024 : 0;
  if (targetBytes && best.size > targetBytes) {
    // binary search on quality
    let lo = 1, hi = Math.max(1, quality - 1);
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const cand = await render(mid, w, h);
      if (cand.size <= targetBytes) { best = cand; lo = mid + 1; } else hi = mid - 1;
    }
    // still too big → iteratively downscale + re-search
    let attempts = 0;
    while (best.size > targetBytes && attempts < 8 && w > 32) {
      w = Math.max(16, Math.round(w * 0.85)); h = Math.max(16, Math.round(h * 0.85));
      let localBest = await render(1, w, h);
      lo = 1; hi = 30;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const cand = await render(mid, w, h);
        if (cand.size <= targetBytes) { localBest = cand; lo = mid + 1; } else hi = mid - 1;
      }
      best = localBest; attempts++;
    }
  }
  if (dpi) { try { best = await encodeWithDpi(paintTo(decoded, w, h, 'fill'), outFmt === 'gif' ? 'png' : outFmt, quality, dpi).then((r) => r.blob); } catch { /* ignore */ } }
  void loop;
  const name = `${baseOf(file.name)}-compressed.${outFmt === 'jpeg' ? 'jpg' : (outFmt === 'gif' ? 'png' : outFmt)}`;
  return { blob: best, filename: name };
}

/* ============================================================ other image ops */
export async function convertImage(file, fmt, quality = 92) {
  const d = await decodeImage(file);
  const canvas = paintTo(d, d.width, d.height, 'fill');
  const { blob, ext } = await encodeCanvas(canvas, fmt, quality);
  return { blob, filename: `${baseOf(file.name)}.${ext}` };
}

export async function resizeImage(file, { width = 0, height = 0, percent = 0, keepAspect = true }) {
  const d = await decodeImage(file);
  let w = d.width, h = d.height;
  if (percent) { w = Math.round(d.width * percent / 100); h = Math.round(d.height * percent / 100); }
  else if (width || height) {
    if (keepAspect) {
      if (width && !height) { h = Math.round(d.height * (width / d.width)); w = width; }
      else if (height && !width) { w = Math.round(d.width * (height / d.height)); h = height; }
      else { const s = Math.min(width / d.width, height / d.height); w = Math.round(d.width * s); h = Math.round(d.height * s); }
    } else { w = width || d.width; h = height || d.height; }
  }
  const canvas = paintTo(d, w, h, keepAspect && width && height ? 'inside' : 'fill');
  const ext = extOfName(file.name) === 'png' ? 'png' : 'jpg';
  const { blob } = await encodeCanvas(canvas, ext, 92);
  return { blob, filename: `${baseOf(file.name)}-resized.${blob.type.includes('png') ? 'png' : 'jpg'}` };
}

export async function cropImage(file, { x = 0, y = 0, w = 0, h = 0, aspect = '' }) {
  const d = await decodeImage(file);
  let cw = w, ch = h;
  if (aspect && aspect.includes(':')) {
    const [ar, br] = aspect.split(':').map(Number);
    if (!cw && ch) cw = Math.round(ch * ar / br);
    if (!ch && cw) ch = Math.round(cw * br / ar);
    if (!cw && !ch) { cw = d.width; ch = Math.round(cw * br / ar); if (ch > d.height) { ch = d.height; cw = Math.round(ch * ar / br); } }
  }
  cw = Math.max(1, Math.min(cw || d.width - x, d.width - x));
  ch = Math.max(1, Math.min(ch || d.height - y, d.height - y));
  const out = document.createElement('canvas'); out.width = cw; out.height = ch;
  const g = out.getContext('2d');
  const src = d.bitmap ?? (() => { const c = document.createElement('canvas'); c.width = d.width; c.height = d.height; c.getContext('2d').putImageData(d.imageData, 0, 0); return c; })();
  g.drawImage(src, x, y, cw, ch, 0, 0, cw, ch);
  const { blob } = await encodeCanvas(out, 'png', 92);
  return { blob, filename: `${baseOf(file.name)}-cropped.png` };
}

export async function transformImage(file, { angle = 0, flipH = false, flipV = false }) {
  const d = await decodeImage(file);
  const rot = ((angle % 360) + 360) % 360;
  const swap = rot === 90 || rot === 270;
  const out = document.createElement('canvas');
  out.width = swap ? d.height : d.width; out.height = swap ? d.width : d.height;
  const g = out.getContext('2d');
  g.translate(out.width / 2, out.height / 2);
  g.rotate(rot * Math.PI / 180);
  g.scale(flipH ? -1 : 1, flipV ? -1 : 1);
  const src = d.bitmap ?? (() => { const c = document.createElement('canvas'); c.width = d.width; c.height = d.height; c.getContext('2d').putImageData(d.imageData, 0, 0); return c; })();
  g.drawImage(src, -d.width / 2, -d.height / 2);
  const { blob } = await encodeCanvas(out, 'png', 92);
  return { blob, filename: `${baseOf(file.name)}-transformed.png` };
}

export async function mergeImages(files, { mode = 'vertical', gap = 10, columns = 2, bg = '#ffffff' }) {
  const decoded = [];
  for (const f of files) decoded.push(await decodeImage(f));
  const W = (c) => c.width, H = (c) => c.height;
  const toCanvas = (d) => {
    const c = document.createElement('canvas'); c.width = d.width; c.height = d.height;
    const g = c.getContext('2d');
    const src = d.bitmap ?? (() => { const t = document.createElement('canvas'); t.width = d.width; t.height = d.height; t.getContext('2d').putImageData(d.imageData, 0, 0); return t; })();
    g.drawImage(src, 0, 0); return c;
  };
  const canvases = decoded.map(toCanvas);
  const out = document.createElement('canvas');
  const g = out.getContext('2d');
  if (mode === 'horizontal') {
    out.width = canvases.reduce((a, c) => a + W(c), 0) + gap * (canvases.length - 1);
    out.height = Math.max(...canvases.map(H));
  } else if (mode === 'grid') {
    const cols = Math.max(1, columns);
    const rows = Math.ceil(canvases.length / cols);
    const cw = Math.max(...canvases.map(W)), chh = Math.max(...canvases.map(H));
    out.width = cols * cw + (cols - 1) * gap; out.height = rows * chh + (rows - 1) * gap;
  } else {
    out.width = Math.max(...canvases.map(W));
    out.height = canvases.reduce((a, c) => a + H(c), 0) + gap * (canvases.length - 1);
  }
  g.fillStyle = bg; g.fillRect(0, 0, out.width, out.height);
  canvases.forEach((c, i) => {
    let x = 0, y = 0;
    if (mode === 'horizontal') x = canvases.slice(0, i).reduce((a, k) => a + W(k) + gap, 0);
    else if (mode === 'grid') { const cols = Math.max(1, columns); x = (i % cols) * (W(c) + gap); y = Math.floor(i / cols) * (H(c) + gap); }
    else y = canvases.slice(0, i).reduce((a, k) => a + H(k) + gap, 0);
    g.drawImage(c, x, y);
  });
  const { blob } = await encodeCanvas(out, 'png', 92);
  return { blob, filename: 'merged.png' };
}

/** Build an animated GIF entirely client-side (gif.js worker, open source). */
export async function imagesToGif(files, { delay = 100, loop = true, scaleWidth = 0 }) {
  const { GIFEncoder, quantize, applyPalette } = await import('gifenc');
  const frames = [];
  for (const f of files) {
    const img = new Image();
    img.src = URL.createObjectURL(f);
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error(`Could not read ${f.name}`)); });
    frames.push(img);
  }
  let w = Math.max(...frames.map((i) => i.naturalWidth));
  let h = Math.max(...frames.map((i) => i.naturalHeight));
  if (scaleWidth) { h = Math.round(h * scaleWidth / w); w = scaleWidth; }
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  const enc = GIFEncoder();
  for (const img of frames) {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    g.drawImage(img, Math.round((w - img.naturalWidth) / 2), Math.round((h - img.naturalHeight) / 2),
      img.naturalWidth, img.naturalHeight);
    const rgba = g.getImageData(0, 0, w, h).data;
    const palette = quantize(rgba, 256);
    const index = applyPalette(rgba, palette);
    enc.writeFrame(index, w, h, { palette, delay, repeat: 0 });
    URL.revokeObjectURL(img.src);
  }
  enc.finish();
  const blob = new Blob([enc.bytes()], { type: 'image/gif' });
  return { blob, filename: 'animation.gif' };
}

/** Extract every frame of an animated GIF (uses the browser ImageDecoder API when available). */
export async function gifExtractFrames(file, fmt = 'png') {
  // Use a tiny built-in GIF LZW decoder-free approach: draw successive animation
  // states is unreliable across browsers, so we decode with @jsquash? Not available.
  // Fallback: parse GIF blocks minimally for frame count, then use ImageDecoder API.
  if (typeof ImageDecoder !== 'undefined') {
    try {
      const decoder = new ImageDecoder({ data: file.stream(), type: 'image/gif' });
      const info = await decoder.tracks.selected.trackInformation();
      const frames = Number(info.frameCount || 1);
      const out = [];
      for (let i = 0; i < frames; i++) {
        const { image } = await decoder.decode();
        const c = document.createElement('canvas'); c.width = image.displayWidth; c.height = image.displayHeight;
        c.getContext('2d').drawImage(image, 0, 0);
        image.close?.();
        const { blob, ext } = await encodeCanvas(c, fmt === 'jpg' ? 'jpg' : 'png', 92);
        out.push({ blob, filename: `${baseOf(file.name)}-frame-${String(i + 1).padStart(3, '0')}.${ext}` });
      }
      return out;
    } catch { /* fall through */ }
  }
  const d = await decodeImage(file);
  const c = paintTo(d, d.width, d.height, 'fill');
  const { blob, ext } = await encodeCanvas(c, fmt === 'jpg' ? 'jpg' : 'png', 92);
  return [{ blob, filename: `${baseOf(file.name)}-frame-001.${ext}` }];
}

/* ============================================================ PDF (client) */
let _pdfDocLib = null;
async function pdfLib() {
  if (!_pdfDocLib) _pdfDocLib = import('pdf-lib');
  return _pdfDocLib;
}
let _pdfjsWorkerDone = false;
async function pdfjs() {
  const lib = await import('pdfjs-dist/build/pdf.mjs');
  if (!_pdfjsWorkerDone) {
    const workerUrl = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url);
    lib.GlobalWorkerOptions.workerSrc = workerUrl.href;
    _pdfjsWorkerDone = true;
  }
  return lib;
}

export async function pdfMerge(files) {
  const { PDFDocument } = await pdfLib();
  const out = await PDFDocument.create();
  for (const f of files) {
    const src = await PDFDocument.load(await f.arrayBuffer(), { ignoreEncryption: true });
    if (src.isEncrypted) throw new Error(`${f.name} is password-protected — unlock it first`);
    (await out.copyPages(src, src.getPageIndices())).forEach((p) => out.addPage(p));
  }
  return { blob: new Blob([await out.save()], { type: 'application/pdf' }), filename: 'merged.pdf' };
}

function parseRanges(spec, total) {
  const idx = new Set();
  for (const part of String(spec || '').split(',')) {
    const t = part.trim(); if (!t) continue;
    if (t.includes('-')) { const [a, b] = t.split('-').map((x) => parseInt(x, 10)); for (let i = Math.max(1, a || 1); i <= Math.min(total, b || total); i++) idx.add(i - 1); }
    else { const n = parseInt(t, 10); if (Number.isFinite(n) && n >= 1 && n <= total) idx.add(n - 1); }
  }
  return [...idx].sort((a, b) => a - b);
}

export async function pdfSplit(file, { mode = 'ranges', ranges = '1-1', every = 1 }) {
  const { PDFDocument } = await pdfLib();
  const doc = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
  if (doc.isEncrypted) throw new Error('PDF is password-protected');
  const total = doc.getPageCount();
  const mkDoc = async (idxs) => { const nd = await PDFDocument.create(); (await nd.copyPages(doc, idxs)).forEach((p) => nd.addPage(p)); return new Blob([await nd.save()], { type: 'application/pdf' }); };
  const base = baseOf(file.name);
  if (mode === 'all-pages') { const out = []; for (let i = 0; i < total; i++) out.push({ blob: await mkDoc([i]), filename: `${base}-page-${i + 1}.pdf` }); return out; }
  if (mode === 'every-n') { const out = []; for (let s = 0; s < total; s += Math.max(1, every)) { const idxs = []; for (let i = s; i < Math.min(s + every, total); i++) idxs.push(i); out.push({ blob: await mkDoc(idxs), filename: `${base}-part-${out.length + 1}.pdf` }); } return out; }
  const idxs = parseRanges(ranges, total);
  if (!idxs.length) throw new Error('Invalid page ranges');
  return [{ blob: await mkDoc(idxs), filename: `${base}-extracted.pdf` }];
}

export async function pdfRotate(file, { angle = 90, pagesSpec = '' }) {
  const { PDFDocument, degrees } = await pdfLib();
  const doc = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
  if (doc.isEncrypted) throw new Error('PDF is password-protected');
  const targets = pagesSpec.trim() ? parseRanges(pagesSpec, doc.getPageCount()) : doc.getPages().map((_, i) => i);
  const pages = doc.getPages();
  for (const i of targets) { let r = (pages[i].getRotation().angle + angle) % 360; if (r < 0) r += 360; pages[i].setRotation(degrees(r)); }
  return { blob: new Blob([await doc.save()], { type: 'application/pdf' }), filename: `${baseOf(file.name)}-rotated.pdf` };
}

export async function pdfToImages(file, { dpi = 150, fmt = 'png' }) {
  const lib = await pdfjs();
  const task = lib.getDocument({ data: await file.arrayBuffer() });
  const doc = await task.promise;
  if (doc.isEncrypted) { try { await doc.checkPermissions?.(); } catch { throw new Error('PDF is password-protected'); } }
  const base = baseOf(file.name);
  const out = [];
  const scale = Math.max(36, dpi) / 72;
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
    const g = canvas.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: g, viewport }).promise;
    const { blob, ext } = await encodeCanvas(canvas, fmt === 'jpg' ? 'jpg' : 'png', 92);
    out.push({ blob, filename: `${base}-page-${String(i).padStart(3, '0')}.${ext}` });
    page.cleanup();
  }
  await doc.destroy();
  return out;
}

export async function imagesToPdf(files, { pageSize = 'fit', margin = 0 }) {
  const { PDFDocument } = await pdfLib();
  const doc = await PDFDocument.create();
  for (const f of files) {
    const buf = await f.arrayBuffer();
    let embed;
    try { embed = /png$/i.test(f.name) || f.type === 'image/png' ? await doc.embedPng(buf) : await doc.embedJpg(buf); }
    catch {
      // re-encode anything exotic to PNG via canvas
      const d = await decodeImage(f);
      const c = paintTo(d, d.width, d.height, 'fill');
      const pngBlob = await new Promise((r) => c.toBlob(r, 'image/png'));
      embed = await doc.embedPng(await pngBlob.arrayBuffer());
    }
    if (pageSize === 'a4') {
      const page = doc.addPage([595, 842]);
      const s = Math.min((595 - 2 * margin) / embed.width, (842 - 2 * margin) / embed.height, 1);
      const w = embed.width * s, h = embed.height * s;
      page.drawImage(embed, { x: (595 - w) / 2, y: (842 - h) / 2, width: w, height: h });
    } else {
      const page = doc.addPage([embed.width + 2 * margin, embed.height + 2 * margin]);
      page.drawImage(embed, { x: margin, y: margin, width: embed.width, height: embed.height });
    }
  }
  return { blob: new Blob([await doc.save()], { type: 'application/pdf' }), filename: 'images-to-pdf.pdf' };
}

export async function pdfWatermark(file, opts) {
  const { PDFDocument, StandardFonts, rgb, degrees } = await pdfLib();
  const doc = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
  if (doc.isEncrypted) throw new Error('PDF is password-protected');
  const { text = 'CONFIDENTIAL', opacity = 0.15, size = 48, position = 'center', tile = false, rotate = true, color = '#a3e635', imageFile = null } = opts;
  const hex = String(color).replace('#', '');
  const col = rgb(parseInt(hex.slice(0, 2), 16) / 255 || 0.64, parseInt(hex.slice(2, 4), 16) / 255 || 0.9, parseInt(hex.slice(4, 6), 16) / 255 || 0.2);
  const wmPos = (width, height, w, h) => {
    const pad = 30;
    switch (position) {
      case 'top-left': return { x: pad, y: height - h - pad };
      case 'top-right': return { x: width - w - pad, y: height - h - pad };
      case 'bottom-left': return { x: pad, y: pad };
      case 'bottom-right': return { x: width - w - pad, y: pad };
      default: return { x: (width - w) / 2, y: (height - h) / 2 };
    }
  };
  const pages = doc.getPages();
  if (imageFile) {
    const embed = /png$/i.test(imageFile.name) ? await doc.embedPng(await imageFile.arrayBuffer()) : await doc.embedJpg(await imageFile.arrayBuffer());
    for (const page of pages) {
      const { width, height } = page.getSize();
      const w = Math.min(size * 4, width / 3);
      const h = w * (embed.height / embed.width);
      page.drawImage(embed, { ...wmPos(width, height, w, h), width: w, height: h, opacity });
    }
  } else {
    const font = await doc.embedFont(StandardFonts.HelveticaBold);
    const rot = degrees(rotate ? 45 : 0);
    for (const page of pages) {
      const { width, height } = page.getSize();
      const tw = font.widthOfTextAtSize(text, size);
      if (tile) {
        for (let y = 0; y < height + size; y += size * 4)
          for (let x = 0; x < width + tw; x += tw + size * 2)
            page.drawText(text, { x, y, size, font, color: col, opacity, rotate: rot });
      } else {
        page.drawText(text, { ...wmPos(width, height, tw, size), size, font, color: col, opacity, rotate: rot });
      }
    }
  }
  return { blob: new Blob([await doc.save()], { type: 'application/pdf' }), filename: `${baseOf(file.name)}-watermarked.pdf` };
}

/** Client-side PDF compressor: rasterize each page (pdf.js) at chosen DPI/quality, rebuild with pdf-lib. Honors grayscale + presets. */
export async function pdfCompress(file, opts) {
  const { preset = '', dpi = 150, quality = 60, grayscale = false } = opts;
  const PRESETS = { low: [200, 80], medium: [150, 65], high: [100, 50], extreme: [72, 30] };
  let D = dpi, Q = quality;
  if (PRESETS[preset]) [D, Q] = PRESETS[preset];
  const lib = await pdfjs();
  const { PDFDocument } = await pdfLib();
  const task = lib.getDocument({ data: await file.arrayBuffer() });
  const doc = await task.promise;
  if (doc.isEncrypted) throw new Error('PDF is password-protected');
  const out = await PDFDocument.create();
  const scale = Math.max(36, D) / 72;
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
    const g = canvas.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: g, viewport: vp }).promise;
    if (grayscale) {
      const id = g.getImageData(0, 0, canvas.width, canvas.height);
      for (let p = 0; p < id.data.length; p += 4) {
        const v = Math.round(0.299 * id.data[p] + 0.587 * id.data[p + 1] + 0.114 * id.data[p + 2]);
        id.data[p] = id.data[p + 1] = id.data[p + 2] = v;
      }
      g.putImageData(id, 0, 0);
    }
    const jpegBlob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', Math.max(0.05, Math.min(1, Q / 100))));
    const embed = await out.embedJpg(await jpegBlob.arrayBuffer());
    const { width, height } = page.getViewport({ scale: 1 });
    const pg = out.addPage([width, height]);
    pg.drawImage(embed, { x: 0, y: 0, width, height });
    page.cleanup();
  }
  await doc.destroy();
  let blob = new Blob([await out.save({ useObjectStreams: true })], { type: 'application/pdf' });
  if (blob.size >= file.size) blob = new Blob([await file.arrayBuffer()], { type: 'application/pdf' }); // never grow
  return { blob, filename: `${baseOf(file.name)}-compressed.pdf` };
}
