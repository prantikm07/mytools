// prymo ToolBox — Netlify Function: API gateway.
//
// Behavior:
//  1. If PRYMO_API_URL is configured (a self-hosted FastAPI backend), every
//     /api/* request is proxied straight through to it (files included).
//  2. Otherwise, a built-in serverless implementation handles the tools that
//     run inside a Lambda-style function: image processing (sharp),
//     PDF merge/split/rotate/watermark/pdf-to-images/images-to-pdf/compress
//     (pdf-lib + MuPDF wasm), QR/barcode generation and ZIP packing.
//
// 100% open-source libraries only. No paid APIs.

// ---------------------------------------------------------------- helpers
const json = (obj, status = 200) => ({
  statusCode: status,
  headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
  body: JSON.stringify(obj),
});

const file = (buf, filename, mime) => ({
  statusCode: 200,
  headers: {
    'content-type': mime || 'application/octet-stream',
    'content-disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
    'access-control-allow-origin': '*',
  },
  isBase64Encoded: true,
  body: Buffer.from(buf).toString('base64'),
});

const bad = (msg, status = 400) => json({ detail: msg }, status);

function parseMultipart(rawBody, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!m) throw new Error('missing multipart boundary');
  const boundary = '--' + (m[1] || m[2]).trim();
  const parts = rawBody.split(Buffer.from(boundary));
  const fields = {};
  const files = {}; // name -> [{filename, content}]
  for (const part of parts) {
    if (part.length < 3) continue;
    let p = part;
    if (p.slice(0, 2).toString() === '\r\n') p = p.slice(2);
    if (p.slice(0, 2).toString() === '--') continue; // closing boundary
    const sep = p.indexOf('\r\n\r\n');
    if (sep === -1) continue;
    const headerText = p.slice(0, sep).toString();
    let content = p.slice(sep + 4);
    if (content.slice(-2).toString() === '\r\n') content = content.slice(0, -2);
    const nm = /name="([^"]*)"/i.exec(headerText);
    const fm = /filename="([^"]*)"/i.exec(headerText);
    if (!nm) continue;
    if (fm && fm[1]) (files[nm[1]] ||= []).push({ filename: fm[1], content });
    else fields[nm[1]] = content.toString('utf8');
  }
  return { fields, files };
}

const asBool = (v, d = false) =>
  v === undefined ? d : ['true', '1', 'yes', 'on'].includes(String(v).toLowerCase());
const asInt = (v, d = 0) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};
const baseName = (n) => (n || 'file').replace(/\.[^.]+$/, '').replace(/[^\w.-]/g, '_');
const mimeFor = (n) =>
  n.endsWith('.png') ? 'image/png' : n.endsWith('.jpg') ? 'image/jpeg' :
  n.endsWith('.webp') ? 'image/webp' : n.endsWith('.gif') ? 'image/gif' :
  n.endsWith('.pdf') ? 'application/pdf' : n.endsWith('.svg') ? 'image/svg+xml' :
  'application/octet-stream';

// ---------------------------------------------------------------- proxy mode
async function proxyToBackend(event) {
  const base = process.env.PRYMO_API_URL.replace(/\/+$/, '');
  const u = new URL(event.rawUrl || ('https://x' + event.path));
  const res = await fetch(base + u.pathname + u.search, {
    method: event.httpMethod,
    headers: (() => {
      const h = {};
      for (const [k, v] of Object.entries(event.headers || {})) {
        if (!['host', 'x-forwarded-for', 'connection', 'content-length'].includes(k.toLowerCase())) h[k] = v;
      }
      return h;
    })(),
    body: event.body == null ? undefined
      : event.isBase64Encoded ? Buffer.from(event.body, 'base64') : event.body,
  });
  const buf = Buffer.from(await res.arrayBuffer());
  const outHeaders = { 'access-control-allow-origin': '*' };
  for (const k of ['content-type', 'content-disposition']) {
    const v = res.headers.get(k);
    if (v) outHeaders[k] = v;
  }
  return { statusCode: res.status, headers: outHeaders, isBase64Encoded: true, body: buf.toString('base64') };
}

// ---------------------------------------------------------------- main router
export default async function handler(event) {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return {
        statusCode: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET,POST,OPTIONS',
          'access-control-allow-headers': '*',
        },
        body: '',
      };
    }
    if (process.env.PRYMO_API_URL) return await proxyToBackend(event);

    const path = (event.path || '').replace(/^\/\.netlify\/functions\/api/, '') || '/';

    if (path === '/health') {
      return json({ ok: true, mode: 'serverless', ghostscript: false, ffmpeg: false, qpdf: false });
    }

    if (event.httpMethod === 'GET') {
      if (path.startsWith('/utils/')) return await utilsRoute(path, event.queryStringParameters || {});
      if (path === '/media/transcribe-status') {
        return json({ available: false, model: 'base', hint: 'needs the full backend (see README)' });
      }
      return bad(`Unknown GET path: ${path}`, 404);
    }

    const raw = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64')
      : Buffer.from(event.body || '', 'utf8');
    const { fields, files } = parseMultipart(raw, event.headers?.['content-type']);

    if (path.startsWith('/images/')) return await imageRoute(path, fields, files);
    if (path.startsWith('/pdf/')) return await pdfRoute(path, fields, files);
    if (path.startsWith('/utils/')) return await utilsRoute(path, fields);
    if (path.startsWith('/media/')) {
      return bad('Video/Audio tools need the full backend with FFmpeg & faster-whisper. ' +
        'See README "Backend hosting", then set PRYMO_API_URL on Netlify.');
    }
    return bad(`Unknown API path: ${path}`, 404);
  } catch (err) {
    console.error(err);
    return bad(String(err.message || err));
  }
}

// ---------------------------------------------------------------- images
async function imageRoute(path, fields, files) {
  const sharp = (await import('sharp')).default;
  const uploads = files.files || (files.file ? [files.file[0]] : []);
  if (!uploads.length) return bad('No files uploaded');

  const FMT = { jpg: 'jpeg', jpeg: 'jpeg', png: 'png', webp: 'webp' };
  const extOf = (f) => (FMT[f] === 'jpeg' ? 'jpg' : FMT[f] || f);
  const toOpts = (fmt, q) =>
    FMT[fmt] === 'jpeg' ? { format: 'jpeg', quality: q, progressive: true }
      : FMT[fmt] === 'webp' ? { format: 'webp', quality: q, effort: 5 }
        : { format: 'png', compressionLevel: 9 };

  // binary-search quality to hit target size (bytes), downscale fallback loop
  async function compressToTarget(img, targetBytes, maxW, maxH, fmt, quality) {
    let work = img.clone();
    const meta = await img.metadata();
    let width = meta.width || 1024, height = meta.height || 1024;
    if (maxW || maxH) {
      const ratio = Math.min((maxW || width) / width, (maxH || height) / height, 1);
      if (ratio < 1) {
        width = Math.max(1, Math.round(width * ratio));
        height = Math.max(1, Math.round(height * ratio));
        work = work.resize({ width, height });
      }
    }
    const render = (q, w, h) =>
      work.clone().resize({ width: w, height: h, fit: 'fill' }).toFormat(toOpts(fmt, q)).toBuffer();
    let best = await render(quality, width, height);
    if (targetBytes && best.length > targetBytes) {
      let lo = 1, hi = Math.max(1, quality - 1);
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const cand = await render(mid, width, height);
        if (cand.length <= targetBytes) { best = cand; lo = mid + 1; } else hi = mid - 1;
      }
      let attempts = 0;
      while (best.length > targetBytes && attempts < 8 && width > 32) {
        width = Math.max(16, Math.round(width * 0.85));
        height = Math.max(16, Math.round(height * 0.85));
        let localBest = await render(1, width, height);
        lo = 1; hi = 30;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          const cand = await render(mid, width, height);
          if (cand.length <= targetBytes) { localBest = cand; lo = mid + 1; } else hi = mid - 1;
        }
        best = localBest;
        attempts++;
      }
    }
    return best;
  }

  switch (path) {
    case '/images/compress': {
      const quality = Math.max(1, Math.min(100, asInt(fields.quality, 80)));
      const maxW = asInt(fields.max_width, 0);
      const maxH = asInt(fields.max_height, 0);
      const target = asInt(fields.target_kb, 0) * 1024;
      const results = [];
      for (const u of uploads) {
        let img = sharp(u.content, { failOn: 'none' }).rotate(); // auto-orient via EXIF
        if (asBool(fields.strip, true)) img = img.withMetadata({ orientation: 1 }); // drop residual metadata
        const meta = await img.metadata();
        const srcFmt = meta.format === 'png' ? 'png' : meta.format === 'webp' ? 'webp' : 'jpg';
        const fmt = fields.fmt && FMT[fields.fmt] ? fields.fmt : srcFmt;
        let dpi = asInt(fields.dpi, 0);
        const buf = await compressToTarget(img, target, maxW, maxH, fmt, quality);
        let finalBuf = buf;
        if (dpi && FMT[fmt] !== 'png') {
          // re-stamp DPI (sharp supports density on read; write via tiff-free trick: keep pixels, tag via exif)
          finalBuf = await sharp(buf, { failOn: 'none' }).withMetadata({ density: dpi }).toBuffer();
        }
        results.push({ name: `${baseName(u.filename)}-compressed.${extOf(fmt)}`, data: finalBuf });
      }
      return singleOrZip(results);
    }
    case '/images/convert': {
      const fmt = fields.fmt || 'jpg';
      const q = asInt(fields.quality, 90);
      const results = [];
      for (const u of uploads) {
        const data = await sharp(u.content, { failOn: 'none' }).rotate().toFormat(toOpts(fmt, q)).toBuffer();
        results.push({ name: `${baseName(u.filename)}.${extOf(fmt)}`, data });
      }
      return singleOrZip(results);
    }
    case '/images/resize': {
      const percent = asInt(fields.percent, 0);
      const w = asInt(fields.width, 0), h = asInt(fields.height, 0);
      const keepAspect = asBool(fields.keep_aspect, true);
      const results = [];
      for (const u of uploads) {
        const img = sharp(u.content, { failOn: 'none' }).rotate();
        const meta = await img.metadata();
        let opts;
        if (percent) {
          opts = { width: Math.max(1, Math.round(meta.width * percent / 100)),
            height: Math.max(1, Math.round(meta.height * percent / 100)), fit: 'fill' };
        } else if (w || h) {
          opts = keepAspect
            ? { width: w || undefined, height: h || undefined, fit: 'inside' }
            : { width: w || undefined, height: h || undefined, fit: 'fill' };
        } else opts = {};
        const fmt = fields.fmt && FMT[fields.fmt] ? fields.fmt : (meta.format === 'png' ? 'png' : 'jpg');
        const data = await img.clone().resize(opts).toFormat(toOpts(fmt, 90)).toBuffer();
        results.push({ name: `${baseName(u.filename)}-resized.${extOf(fmt)}`, data });
      }
      return singleOrZip(results);
    }
    case '/images/crop': {
      const results = [];
      for (const u of uploads) {
        const img = sharp(u.content, { failOn: 'none' }).rotate();
        const meta = await img.metadata();
        let left = asInt(fields.x, 0), top = asInt(fields.y, 0);
        let cw = asInt(fields.w, 0), ch = asInt(fields.h, 0);
        const aspect = fields.aspect || '';
        if (aspect.includes(':')) {
          const [ar, br] = aspect.split(':').map(Number);
          if (ar > 0 && br > 0) {
            if (!cw && ch) cw = Math.round(ch * ar / br);
            if (!ch && cw) ch = Math.round(cw * br / ar);
            if (!cw && !ch) { cw = meta.width; ch = Math.round(cw * br / ar); if (ch > meta.height) { ch = meta.height; cw = Math.round(ch * ar / br); } }
          }
        }
        left = Math.max(0, Math.min(left, meta.width - 1));
        top = Math.max(0, Math.min(top, meta.height - 1));
        const width = Math.max(1, Math.min(cw || meta.width - left, meta.width - left));
        const height = Math.max(1, Math.min(ch || meta.height - top, meta.height - top));
        const data = await img.extract({ left, top, width, height }).png().toBuffer();
        results.push({ name: `${baseName(u.filename)}-cropped.png`, data });
      }
      return singleOrZip(results);
    }
    case '/images/transform': {
      const angle = asInt(fields.angle, 0);
      const fh = asBool(fields.flip_h), fv = asBool(fields.flip_v);
      const results = [];
      for (const u of uploads) {
        let img = sharp(u.content, { failOn: 'none' }).rotate(angle);
        if (fh) img = img.flop();
        if (fv) img = img.flip();
        const data = await img.png().toBuffer();
        results.push({ name: `${baseName(u.filename)}-transformed.png`, data });
      }
      return singleOrZip(results);
    }
    case '/images/merge': {
      if (uploads.length < 2) return bad('Add at least two images to merge');
      const mode = fields.mode || 'vertical';
      const gap = asInt(fields.gap, 10);
      const cols = Math.max(1, asInt(fields.columns, 2));
      const bgHex = (fields.bg || '#ffffff').replace('#', '');
      const background = { r: parseInt(bgHex.slice(0, 2), 16) || 255,
        g: parseInt(bgHex.slice(2, 4), 16) || 255, b: parseInt(bgHex.slice(4, 6), 16) || 255, alpha: 1 };
      const metas = [];
      const buffers = [];
      for (const u of uploads) {
        const im = sharp(u.content, { failOn: 'none' }).rotate();
        metas.push(await im.metadata());
        buffers.push(im);
      }
      let canvas, W, H, composites = [];
      const prep = async (i, w, h) => buffers[i].clone().resize({ width: w, height: h, fit: 'fill' })
        .flatten({ background }).png().toBuffer();
      if (mode === 'horizontal') {
        H = Math.max(...metas.map((m) => m.height));
        const widths = metas.map((m) => Math.round(m.width * (H / m.height)));
        W = widths.reduce((a, b) => a + b, 0) + gap * (metas.length - 1);
        canvas = sharp({ create: { width: W, height: H, channels: 3, background } });
        let x = 0;
        for (let i = 0; i < metas.length; i++) {
          composites.push({ input: await prep(i, widths[i], H), left: x, top: 0 });
          x += widths[i] + gap;
        }
      } else if (mode === 'grid') {
        const cellW = Math.max(...metas.map((m) => m.width));
        const cellH = Math.max(...metas.map((m) => m.height));
        const rows = Math.ceil(metas.length / cols);
        W = cols * cellW + (cols - 1) * gap; H = rows * cellH + (rows - 1) * gap;
        canvas = sharp({ create: { width: W, height: H, channels: 3, background } });
        for (let i = 0; i < metas.length; i++) {
          const r = Math.floor(i / cols), c = i % cols;
          composites.push({ input: await prep(i, cellW, cellH), left: c * (cellW + gap), top: r * (cellH + gap) });
        }
      } else {
        W = Math.max(...metas.map((m) => m.width));
        const heights = metas.map((m) => Math.round(m.height * (W / m.width)));
        H = heights.reduce((a, b) => a + b, 0) + gap * (metas.length - 1);
        canvas = sharp({ create: { width: W, height: H, channels: 3, background } });
        let y = 0;
        for (let i = 0; i < metas.length; i++) {
          composites.push({ input: await prep(i, W, heights[i]), left: 0, top: y });
          y += heights[i] + gap;
        }
      }
      const data = await canvas.composite(composites).png().toBuffer();
      return singleOrZip([{ name: 'merged.png', data }]);
    }
    case '/images/colors': {
      const count = Math.max(2, Math.min(12, asInt(fields.count, 6)));
      const palettes = [];
      for (const u of uploads) {
        const { data } = await sharp(u.content, { failOn: 'none' }).rotate()
          .resize({ width: 120 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        const map = new Map();
        for (let i = 0; i < data.length; i += 3) {
          const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
          const e = map.get(key) || { r: 0, g: 0, b: 0, n: 0 };
          e.r += data[i]; e.g += data[i + 1]; e.b += data[i + 2]; e.n++;
          map.set(key, e);
        }
        const colors = [...map.values()].sort((a, b) => b.n - a.n).slice(0, count).map((e) => {
          const r = Math.round(e.r / e.n), g = Math.round(e.g / e.n), b = Math.round(e.b / e.n);
          return { hex: '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase(), rgb: [r, g, b] };
        });
        palettes.push({ file: u.filename, colors });
      }
      return json({ palettes });
    }
    case '/images/to-gif':
    case '/images/gif-extract':
      return bad('GIF creation/extraction needs the full backend (Pillow). See README "Backend hosting".');
    default:
      return bad(`Unknown image route ${path}`, 404);
  }
}

function singleOrZip(results) {
  if (results.length === 1) {
    const r = results[0];
    return file(r.data, r.name, mimeFor(r.name));
  }
  return zipResponse(results, 'prymo-batch.zip');
}

async function zipResponse(entries, filename) {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  const used = new Set();
  for (const e of entries) {
    let name = e.name, i = 1;
    while (used.has(name)) {
      const m = /^(.*?)(\.[^.]*)?$/.exec(e.name);
      name = `${m[1]}(${i})${m[2] || ''}`; i++;
    }
    used.add(name);
    zip.file(name, e.data);
  }
  const data = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  return file(data, filename, 'application/zip');
}

// ---------------------------------------------------------------- pdf routes
async function pdfRoute(path, fields, files) {
  const { PDFDocument, degrees, rgb, StandardFonts } = await import('pdf-lib');
  const one = (files.file && files.file[0]) || (files.files && files.files[0]);
  const many = files.files || (files.file ? [files.file[0]] : []);

  switch (path) {
    case '/pdf/merge': {
      if (!many.length) return bad('Upload at least one PDF');
      const out = await PDFDocument.create();
      for (const u of many) {
        const src = await PDFDocument.load(u.content, { ignoreEncryption: true });
        if (src.isEncrypted) return bad('A PDF is password-protected. Use Unlock PDF on the full backend.');
        const pages = await out.copyPages(src, src.getPageIndices());
        pages.forEach((p) => out.addPage(p));
      }
      return file(await out.save(), 'merged.pdf', 'application/pdf');
    }
    case '/pdf/split': {
      if (!one) return bad('Upload a PDF');
      const doc = await PDFDocument.load(one.content, { ignoreEncryption: true });
      if (doc.isEncrypted) return bad('PDF is password-protected.');
      const total = doc.getPageCount();
      const base = baseName(one.filename);
      const mkDoc = async (idxs) => {
        const nd = await PDFDocument.create();
        (await nd.copyPages(doc, idxs)).forEach((p) => nd.addPage(p));
        return nd.save();
      };
      const mode = fields.mode || 'ranges';
      if (mode === 'all-pages') {
        const entries = [];
        for (let i = 0; i < total; i++) entries.push({ name: `${base}-page-${i + 1}.pdf`, data: await mkDoc([i]) });
        return zipResponse(entries, 'prymo-split.zip');
      }
      if (mode === 'every-n') {
        const every = Math.max(1, asInt(fields.every, 1));
        const entries = [];
        for (let s = 0; s < total; s += every) {
          const idxs = [];
          for (let i = s; i < Math.min(s + every, total); i++) idxs.push(i);
          entries.push({ name: `${base}-part-${entries.length + 1}.pdf`, data: await mkDoc(idxs) });
        }
        return zipResponse(entries, 'prymo-split.zip');
      }
      const idxs = parseRanges(fields.ranges || '1-1', total);
      if (!idxs.length) return bad('Invalid page ranges');
      return file(await mkDoc(idxs), `${base}-extracted.pdf`, 'application/pdf');
    }
    case '/pdf/rotate': {
      if (!one) return bad('Upload a PDF');
      const doc = await PDFDocument.load(one.content, { ignoreEncryption: true });
      if (doc.isEncrypted) return bad('PDF is password-protected.');
      const angle = asInt(fields.angle, 90);
      const spec = (fields.pages_spec || '').trim();
      const targets = spec ? parseRanges(spec, doc.getPageCount()) : doc.getPages().map((_, i) => i);
      const pages = doc.getPages();
      for (const i of targets) {
        let r = (pages[i].getRotation().angle + angle) % 360;
        if (r < 0) r += 360;
        pages[i].setRotation(degrees(r));
      }
      return file(await doc.save(), `${baseName(one.filename)}-rotated.pdf`, 'application/pdf');
    }
    case '/pdf/from-images': {
      if (!many.length) return bad('Upload at least one image');
      const doc = await PDFDocument.create();
      const pageSize = fields.page_size || 'fit';
      const margin = asInt(fields.margin, 0);
      for (const u of many) {
        const embed = /\.png$/i.test(u.filename || '')
          ? await doc.embedPng(u.content) : await doc.embedJpg(u.content);
        if (pageSize === 'a4') {
          const page = doc.addPage([595, 842]);
          const scale = Math.min((595 - 2 * margin) / embed.width, (842 - 2 * margin) / embed.height, 1);
          const w = embed.width * scale, h = embed.height * scale;
          page.drawImage(embed, { x: (595 - w) / 2, y: (842 - h) / 2, width: w, height: h });
        } else {
          const page = doc.addPage([embed.width + 2 * margin, embed.height + 2 * margin]);
          page.drawImage(embed, { x: margin, y: margin, width: embed.width, height: embed.height });
        }
      }
      return file(await doc.save(), 'images-to-pdf.pdf', 'application/pdf');
    }
    case '/pdf/to-images': {
      if (!one) return bad('Upload a PDF');
      const mupdf = (await import('mupdf')).default;
      const doc = mupdf.Document.openDocument(one.content, 'application/pdf');
      if (doc.needsPassword()) return bad('PDF is password-protected.');
      const dpi = Math.max(36, asInt(fields.dpi, 150));
      const zoom = dpi / 72;
      const fmt = (fields.fmt || 'png') === 'jpg' ? 'jpg' : 'png';
      const base = baseName(one.filename);
      const entries = [];
      for (let i = 0; i < doc.countPages(); i++) {
        const page = doc.loadPage(i);
        const pix = page.toPixmap(mupdf.Matrix.scale(zoom, zoom), mupdf.ColorSpace.DeviceRGB, false, true);
        const img = pix.asImage();
        const bytes = fmt === 'jpg' ? img.writeJPEG(90) : img.writePNG();
        entries.push({ name: `${base}-page-${String(i + 1).padStart(3, '0')}.${fmt}`, data: Buffer.from(bytes) });
        page.destroy(); pix.destroy();
      }
      doc.destroy();
      if (entries.length === 1) return file(entries[0].data, entries[0].name, mimeFor(entries[0].name));
      return zipResponse(entries, 'prymo-pages.zip');
    }
    case '/pdf/compress': {
      // Serverless compressor: rasterize each page via MuPDF-wasm at the chosen
      // DPI/JPEG quality (honors grayscale + presets) and rebuild with pdf-lib.
      if (!one) return bad('Upload a PDF');
      const mupdf = (await import('mupdf')).default;
      const PRESETS = { low: [200, 80], medium: [150, 65], high: [100, 50], extreme: [72, 30] };
      let dpi = asInt(fields.dpi, 150), quality = asInt(fields.quality, 60);
      if (PRESETS[fields.preset]) [dpi, quality] = PRESETS[fields.preset];
      const grayscale = asBool(fields.grayscale);
      const srcPdf = mupdf.Document.openDocument(one.content, 'application/pdf');
      if (srcPdf.needsPassword()) return bad('PDF is password-protected.');
      const doc = await PDFDocument.create();
      const zoom = Math.max(36, dpi) / 72;
      for (let i = 0; i < srcPdf.countPages(); i++) {
        const page = srcPdf.loadPage(i);
        const bounds = page.getBounds();
        const pw = bounds[2] - bounds[0], ph = bounds[3] - bounds[1];
        const pix = page.toPixmap(mupdf.Matrix.scale(zoom, zoom),
          grayscale ? mupdf.ColorSpace.DeviceGray : mupdf.ColorSpace.DeviceRGB, false, true);
        const jpegBuf = Buffer.from(pix.asImage().writeJPEG(Math.max(1, Math.min(100, quality))));
        pix.destroy();
        const embed = await doc.embedJpg(jpegBuf);
        const p = doc.addPage([pw, ph]);
        p.drawImage(embed, { x: 0, y: 0, width: pw, height: ph });
        page.destroy();
      }
      srcPdf.destroy();
      let outBuf = Buffer.from(await doc.save({ useObjectStreams: true }));
      if (outBuf.length >= one.content.length) outBuf = one.content; // never grow the file
      return file(outBuf, `${baseName(one.filename)}-compressed.pdf`, 'application/pdf');
    }
    case '/pdf/watermark': {
      if (!one) return bad('Upload a PDF');
      const doc = await PDFDocument.load(one.content, { ignoreEncryption: true });
      if (doc.isEncrypted) return bad('PDF is password-protected.');
      const opacity = Math.min(1, Math.max(0.01, parseFloat(fields.opacity ?? 0.15)));
      const size = asInt(fields.size, 48);
      const position = fields.position || 'center';
      const tile = asBool(fields.tile);
      const hex = (fields.color || '#a3e635').replace('#', '');
      const col = rgb(parseInt(hex.slice(0, 2), 16) / 255 || 0.64,
        parseInt(hex.slice(2, 4), 16) / 255 || 0.9, parseInt(hex.slice(4, 6), 16) / 255 || 0.2);
      const pages = doc.getPages();
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
      const imgFile = files.image && files.image[0];
      if (imgFile) {
        const embed = /\.png$/i.test(imgFile.filename || '')
          ? await doc.embedPng(imgFile.content) : await doc.embedJpg(imgFile.content);
        for (const page of pages) {
          const { width, height } = page.getSize();
          const w = Math.min(size * 4, width / 3);
          const h = w * (embed.height / embed.width);
          page.drawImage(embed, { ...wmPos(width, height, w, h), width: w, height: h, opacity });
        }
      } else {
        const text = fields.text || 'CONFIDENTIAL';
        const font = await doc.embedFont(StandardFonts.HelveticaBold);
        const rot = degrees(asBool(fields.rotate, true) ? 45 : 0);
        for (const page of pages) {
          const { width, height } = page.getSize();
          const tw = font.widthOfTextAtSize(text, size);
          if (tile) {
            for (let y = 0; y < height + size; y += size * 4) {
              for (let x = 0; x < width + tw; x += tw + size * 2) {
                page.drawText(text, { x, y, size, font, color: col, opacity, rotate: rot });
              }
            }
          } else {
            page.drawText(text, { ...wmPos(width, height, tw, size), size, font, color: col, opacity, rotate: rot });
          }
        }
      }
      return file(await doc.save(), `${baseName(one.filename)}-watermarked.pdf`, 'application/pdf');
    }
    case '/pdf/protect':
    case '/pdf/unlock':
      return bad('Password protection/removal needs the full backend (qpdf/pypdf AES). See README "Backend hosting".');
    default:
      return bad(`Unknown pdf route ${path}`, 404);
  }
}

function parseRanges(spec, total) {
  const idx = new Set();
  for (const part of String(spec).split(',')) {
    const t = part.trim();
    if (!t) continue;
    if (t.includes('-')) {
      const [a, b] = t.split('-').map((x) => parseInt(x, 10));
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      for (let i = Math.max(1, a); i <= Math.min(total, b); i++) idx.add(i - 1);
    } else {
      const n = parseInt(t, 10);
      if (Number.isFinite(n) && n >= 1 && n <= total) idx.add(n - 1);
    }
  }
  return [...idx].sort((a, b) => a - b);
}

// ---------------------------------------------------------------- utils
async function utilsRoute(path, params) {
  if (path === '/utils/qr') {
    const segno = (await import('segno')).default;
    const text = params.text || 'https://example.com';
    const qr = segno.make(text, { error: 'm' });
    const scale = Math.max(2, asInt(params.size, 8));
    const dark = normalizeColor(params.fg, '#a3e635');
    const light = normalizeColor(params.bg, '#000000');
    const data = qr.toDataURL({ scale, dark, light });
    const b64 = data.split(',')[1];
    return file(Buffer.from(b64, 'base64'), 'qr-code.png', 'image/png');
  }
  if (path === '/utils/barcode') {
    const JsBarcode = (await import('jsbarcode')).default;
    const symbologyRaw = String(params.symbology || 'code128').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const FORMAT_MAP = { CODE128: 'CODE128', CODE39: 'CODE39', CODE93: 'CODE93', EAN13: 'EAN13',
      EAN8: 'EAN8', EAN5: 'EAN5', EAN2: 'EAN2', UPC: 'UPC', ITF14: 'ITF14', PHARMACODE: 'PHARMACODE' };
    const format = FORMAT_MAP[symbologyRaw] || 'CODE128';
    const text = params.text || '1234567890';
    // Build a real SVG string via jsbarcode's SVG renderer using a minimal DOM shim.
    const root = svgEl('svg');
    try {
      JsBarcode(root, text, { format, height: asInt(params.height, 80), width: asInt(params.width, 2),
        displayValue: true, background: '#ffffff', lineColor: '#000000' });
    } catch (e) {
      return bad(`Invalid barcode data for ${format}: ${e.message}`);
    }
    let svg = serialize(root);
    if (!svg.startsWith('<svg')) {
      svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 120">${svg}</svg>`;
    } else if (!svg.includes('xmlns')) {
      svg = svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    }
    return file(Buffer.from(svg), 'barcode.svg', 'image/svg+xml');
  }
  if (path === '/utils/password') {
    const crypto = await import('node:crypto');
    const length = Math.max(4, Math.min(128, asInt(params.length, 16)));
    const lower = asBool(params.lower, true), upper = asBool(params.upper, true);
    const digits = asBool(params.digits, true), symbols = asBool(params.symbols, true);
    const exclude = asBool(params.exclude_ambiguous, true);
    let pool = '';
    if (lower) pool += 'abcdefghijklmnopqrstuvwxyz';
    if (upper) pool += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    if (digits) pool += '0123456789';
    if (symbols) pool += '!@#$%^&*()-_=+[]{};:,.<>?';
    if (!pool) return bad('Select at least one character class');
    if (exclude) pool = pool.replace(/[il1Lo0O]/g, '');
    const bytes = crypto.randomBytes(length);
    let pwd = '';
    for (let i = 0; i < length; i++) pwd += pool[bytes[i] % pool.length];
    return json({ password: pwd, length, entropy: Math.round(length * Math.log2(pool.length)), poolSize: pool.length });
  }
  return bad('This utility needs the full backend.', 404);
}

function svgEl(tag) {
  return {
    tagName: tag, attrs: {}, children: [], textContent: '', style: {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    appendChild(c) { this.children.push(c); return c; },
    insertBefore(c) { this.children.unshift(c); return c; },
    setAttributeNS(_ns, k, v) { this.attrs[k] = String(v); },
    addEventListener() {}, removeEventListener() {},
    ownerDocument: null, namespaceURI: 'http://www.w3.org/2000/svg',
  };
}
function serialize(el) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const attrs = Object.entries(el.attrs || {}).map(([k, v]) => `${k}="${esc(v)}"`).join(' ');
  const kids = (el.children || []).map(serialize).join('');
  const txt = el.textContent ? esc(el.textContent) : '';
  const tag = el.tagName || 'rect';
  return kids || txt ? `<${tag} ${attrs}>${kids}${txt}</${tag}>` : `<${tag} ${attrs}/>`;
}
function normalizeColor(v, fallback) {
  const s = (v || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s : fallback;
}
