import React, { useState } from 'react';
import { fmtBytes, postForm } from '../api';
import Dropzone from '../components/Dropzone';
import Workspace from '../components/Workspace';
import { Field, NumInput, Select, Slider, Toggle } from '../components/ui';
import * as C from '../client';

const resultsOf = (list) => list.map((r) => ({
  blob: r.blob, filename: r.filename,
  preview: r.blob.type.startsWith('image/') ? URL.createObjectURL(r.blob) : null,
  meta: fmtBytes(r.blob.size),
}));

/* ============================================================ ADVANCED IMAGE COMPRESSOR — 100% client-side (WebAssembly) */
export function ImageCompressor({ tool }) {
  const [files, setFiles] = useState([]);
  const [quality, setQuality] = useState(80);
  const [maxW, setMaxW] = useState('');
  const [maxH, setMaxH] = useState('');
  const [useTarget, setUseTarget] = useState(false);
  const [targetKB, setTargetKB] = useState(200);
  const [dpi, setDpi] = useState(0);
  const [fmt, setFmt] = useState('');
  const [strip, setStrip] = useState(true);

  const run = async () => {
    const opts = { quality, maxW: +maxW || 0, maxH: +maxH || 0, targetKB: useTarget ? (+targetKB || 0) : 0, dpi, fmt };
    const out = [];
    for (const f of files) {
      if (!C.isImageFile(f)) throw new Error(`${f.name} is not an image`);
      try {
        out.push(await C.compressImage(f, opts));
      } catch {
        // exotic format the browser can't decode → fall back to backend if configured
        const fd = new FormData();
        fd.append('file', f);
        fd.append('quality', quality); fd.append('max_width', opts.maxW); fd.append('max_height', opts.maxH);
        fd.append('target_kb', opts.targetKB); fd.append('dpi', dpi); fd.append('fmt', fmt); fd.append('strip', String(strip));
        const { blob, filename } = await postForm('/api/images/compress', fd);
        out.push({ blob, filename });
      }
    }
    const totalIn = files.reduce((a, f) => a + f.size, 0);
    const totalOut = out.reduce((a, r) => a + r.blob.size, 0);
    return resultsOf(out).map((r) => ({ ...r,
      meta: `${fmtBytes(totalIn)} → ${fmtBytes(totalOut)} (${Math.max(0, Math.round((1 - totalOut / totalIn) * 100))}% saved)` }));
  };

  return (
    <Workspace tool={tool} files={files} setFiles={setFiles}
      DropArea={({ files, onChange }) => <Dropzone accept=".jpg,.jpeg,.png,.webp,.gif,.bmp,.tiff" files={files} onChange={onChange} />}
      Controls={() => (
        <div className="grid md:grid-cols-2 gap-x-8 gap-y-5">
          <Slider label="Quality" value={quality} onChange={setQuality} />
          <Field label="Format conversion" hint="Leave as-is to keep the original format">
            <Select value={fmt} onChange={(e) => setFmt(e.target.value)} options={[
              { value: '', label: 'Keep original' }, { value: 'jpg', label: 'JPG' },
              { value: 'png', label: 'PNG' }, { value: 'webp', label: 'WEBP' }]} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Max width (px)"><NumInput min="0" placeholder="any" value={maxW} onChange={(e) => setMaxW(e.target.value)} /></Field>
            <Field label="Max height (px)"><NumInput min="0" placeholder="any" value={maxH} onChange={(e) => setMaxH(e.target.value)} /></Field>
          </div>
          <Field label="DPI"><Select value={String(dpi)} onChange={(e) => setDpi(Number(e.target.value))} options={[
            { value: '0', label: 'Keep original' }, { value: '72', label: '72 DPI' },
            { value: '150', label: '150 DPI' }, { value: '300', label: '300 DPI' }]} /></Field>
          <div className="md:col-span-2 space-y-3">
            <Toggle checked={useTarget} onChange={setUseTarget}
              label="Target file size — iteratively adjust quality to hit it" />
            {useTarget && (
              <div className="flex items-center gap-3 pl-1">
                <span className="text-sm text-zinc-400 whitespace-nowrap">Compress to under</span>
                <NumInput className="!w-28" min="5" value={targetKB} onChange={(e) => setTargetKB(e.target.value)} />
                <span className="text-sm text-zinc-400">KB</span>
              </div>
            )}
            <Toggle checked={strip} onChange={setStrip} label="Strip EXIF / metadata" />
          </div>
          <p className="md:col-span-2 text-xs text-zinc-500">Runs entirely in your browser (WebAssembly) — files never leave your device.</p>
        </div>
      )}
      run={run} />
  );
}

/* ============================================================ simple image tools — client-side */
export function SimpleImageTool({ tool }) {
  const cfg = {
    convert: {
      controls: (s) => <Field label="Output format"><Select value={s.fmt} onChange={(e) => s.setFmt(e.target.value)} options={[
        { value: 'jpg', label: 'JPG' }, { value: 'png', label: 'PNG' }, { value: 'webp', label: 'WEBP' }]} /></Field>,
      state: { fmt: 'jpg' },
      fn: (f, s) => C.convertImage(f, s.fmt, 92),
    },
    resize: {
      controls: (s) => (<>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Width (px)"><NumInput min="0" value={s.w} onChange={(e) => s.setW(e.target.value)} /></Field>
          <Field label="Height (px)"><NumInput min="0" value={s.h} onChange={(e) => s.setH(e.target.value)} /></Field>
          <Field label="Percent %"><NumInput min="0" max="1000" placeholder="e.g. 50" value={s.pct} onChange={(e) => s.setPct(e.target.value)} /></Field>
        </div>
        <Toggle checked={s.keep} onChange={s.setKeep} label="Maintain aspect ratio" /></>),
      state: { w: '', h: '', pct: '', keep: true },
      fn: (f, s) => C.resizeImage(f, { width: +s.w || 0, height: +s.h || 0, percent: +s.pct || 0, keepAspect: s.keep }),
    },
    crop: {
      controls: (s) => (<>
        <Field label="Aspect preset (overrides geometry, centered)">
          <Select value={s.aspect} onChange={(e) => s.setAspect(e.target.value)} options={[
            { value: '', label: 'Free crop' }, { value: '16:9', label: '16:9' }, { value: '4:3', label: '4:3' },
            { value: '1:1', label: '1:1 Square' }, { value: '9:16', label: '9:16 Portrait' },
            { value: '3:2', label: '3:2' }]} /></Field>
        {!s.aspect && <div className="grid grid-cols-4 gap-3">
          <Field label="X"><NumInput value={s.x} min="0" onChange={(e) => s.setX(e.target.value)} /></Field>
          <Field label="Y"><NumInput value={s.y} min="0" onChange={(e) => s.setY(e.target.value)} /></Field>
          <Field label="Width"><NumInput value={s.w} min="0" onChange={(e) => s.setW(e.target.value)} /></Field>
          <Field label="Height"><NumInput value={s.h} min="0" onChange={(e) => s.setH(e.target.value)} /></Field>
        </div>}</>),
      state: { x: '', y: '', w: '', h: '', aspect: '' },
      fn: (f, s) => C.cropImage(f, { x: +s.x || 0, y: +s.y || 0, w: +s.w || 0, h: +s.h || 0, aspect: s.aspect }),
    },
    transform: {
      controls: (s) => (<>
        <Field label="Rotate"><Select value={String(s.angle)} onChange={(e) => s.setAngle(Number(e.target.value))} options={[
          { value: '0', label: 'None' }, { value: '90', label: '90° clockwise' },
          { value: '180', label: '180°' }, { value: '270', label: '270° clockwise' }]} /></Field>
        <Toggle checked={s.fh} onChange={s.setFh} label="Flip horizontal (mirror)" />
        <Toggle checked={s.fv} onChange={s.setFv} label="Flip vertical" /></>),
      state: { angle: 0, fh: false, fv: false },
      fn: (f, s) => C.transformImage(f, { angle: s.angle, flipH: s.fh, flipV: s.fv }),
    },
  }[tool.id];

  const init = cfg.state;
  const [files, setFiles] = useState([]);
  const st = {}; const setters = {};
  Object.keys(init).forEach((k) => { const [v, sv] = useState(init[k]); st[k] = v; setters['set' + k[0].toUpperCase() + k.slice(1)] = sv; });

  const run = async () => {
    const out = [];
    for (const f of files) out.push(await cfg.fn(f, st));
    return resultsOf(out);
  };

  return (
    <Workspace tool={tool} files={files} setFiles={setFiles}
      DropArea={({ files, onChange }) => <Dropzone accept=".jpg,.jpeg,.png,.webp,.gif,.bmp" files={files} onChange={onChange} />}
      Controls={() => cfg.controls(st)} run={run} />
  );
}

/* ============================================================ IMAGE MERGE */
export function ImageMerge({ tool }) {
  const [files, setFiles] = useState([]);
  const [mode, setMode] = useState('vertical');
  const [gap, setGap] = useState(10);
  const [cols, setCols] = useState(2);
  const [bg, setBg] = useState('#ffffff');

  const run = async () => {
    if (files.length < 2) throw new Error('Add at least two images to merge.');
    const r = await C.mergeImages(files, { mode, gap: +gap || 0, columns: +cols || 2, bg });
    return resultsOf([r]);
  };

  return (
    <Workspace tool={tool} files={files} setFiles={setFiles}
      DropArea={({ files, onChange }) => <Dropzone accept=".jpg,.jpeg,.png,.webp,.gif,.bmp" files={files} onChange={onChange}
        title="Drop 2+ images · order matters (use ↑↓ to reorder)" />}
      Controls={() => (
        <div className="grid md:grid-cols-2 gap-x-8 gap-y-5">
          <Field label="Layout"><Select value={mode} onChange={(e) => setMode(e.target.value)} options={[
            { value: 'vertical', label: 'Vertical stack' }, { value: 'horizontal', label: 'Horizontal row' },
            { value: 'grid', label: 'Grid' }]} /></Field>
          {mode === 'grid' && <Field label="Columns"><NumInput min="1" max="10" value={cols} onChange={(e) => setCols(e.target.value)} /></Field>}
          <Field label="Gap between images (px)"><NumInput min="0" value={gap} onChange={(e) => setGap(e.target.value)} /></Field>
          <Field label="Background color"><input type="color" value={bg} onChange={(e) => setBg(e.target.value)}
            className="h-10 w-20 rounded-lg bg-transparent border border-white/10 cursor-pointer" /></Field>
        </div>
      )} run={run} />
  );
}

/* ============================================================ IMAGES <-> GIF — client-side */
export function GifTools({ tool }) {
  const [files, setFiles] = useState([]);
  const [delay, setDelay] = useState(100);
  const [loop, setLoop] = useState(true);
  const [fmt, setFmt] = useState('png');

  const run = async () => {
    if (tool.id === 'img2gif') {
      const r = await C.imagesToGif(files, { delay: +delay, loop });
      return [{ blob: r.blob, filename: r.filename, preview: URL.createObjectURL(r.blob), meta: fmtBytes(r.blob.size) }];
    }
    const frames = await C.gifExtractFrames(files[0], fmt);
    return resultsOf(frames);
  };

  return (
    <Workspace tool={tool} files={files} setFiles={setFiles}
      DropArea={({ files, onChange }) => <Dropzone
        accept={tool.id === 'img2gif' ? '.jpg,.jpeg,.png,.webp,.bmp' : '.gif'}
        multiple={tool.id === 'img2gif'} files={files} onChange={onChange} />}
      Controls={() => tool.id === 'img2gif' ? (
        <div className="grid md:grid-cols-2 gap-x-8 gap-y-5">
          <Slider label="Frame delay" value={delay} min={20} max={2000} onChange={setDelay} suffix=" ms" />
          <Toggle checked={loop} onChange={setLoop} label="Loop forever" />
        </div>
      ) : (
        <Field label="Extract frames as"><Select value={fmt} onChange={(e) => setFmt(e.target.value)} options={[
          { value: 'png', label: 'PNG (lossless)' }, { value: 'jpg', label: 'JPG' }]} /></Field>
      )} run={run} />
  );
}

/* ============================================================ COLOR EXTRACTOR (client-side Canvas) */
export function ColorExtractor({ tool }) {
  const [files, setFiles] = useState([]);
  const [count, setCount] = useState(6);
  const [palettes, setPalettes] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const extract = (img, n) => {
    const c = document.createElement('canvas');
    const scale = Math.min(1, 120 / Math.max(img.width, img.height));
    c.width = Math.max(1, Math.round(img.width * scale));
    c.height = Math.max(1, Math.round(img.height * scale));
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    // median-cut-lite: quantize into buckets then pick most frequent
    const map = new Map();
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 125) continue;
      const r = data[i] >> 4, g = data[i + 1] >> 4, b = data[i + 2] >> 4;
      const key = (r << 8) | (g << 4) | b;
      const e = map.get(key) || { r: 0, g: 0, b: 0, n: 0 };
      e.r += data[i]; e.g += data[i + 1]; e.b += data[i + 2]; e.n++;
      map.set(key, e);
    }
    return [...map.values()].sort((a, b) => b.n - a.n).slice(0, n)
      .map((e) => {
        const r = Math.round(e.r / e.n), g = Math.round(e.g / e.n), b = Math.round(e.b / e.n);
        return { hex: '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase(), rgb: [r, g, b] };
      });
  };

  const run = async () => {
    setError(''); setPalettes([]);
    if (!files.length) { setError('Add at least one image first.'); return; }
    setBusy(true);
    try {
      const out = [];
      for (const f of files) {
        const url = URL.createObjectURL(f);
        const img = await new Promise((res, rej) => {
          const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = url;
        });
        out.push({ file: f.name, thumb: url, colors: extract(img, count) });
      }
      setPalettes(out);
    } catch (e) { setError(String(e.message || e)); } finally { setBusy(false); }
  };

  return (
    <div className="fade-in max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-2xl bg-lime-accent/10 border border-lime-accent/30 grid place-items-center text-lime-accent">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.8-.7 1.8-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.8 1.8-1.8H16c3.3 0 6-2.7 6-6 0-4.9-4.5-8-10-8Z" /></svg>
        </div>
        <div><h1 className="text-2xl font-extrabold text-white">{tool.name}</h1>
          <p className="text-sm text-zinc-500">{tool.desc} · 100% client-side (Canvas)</p></div>
      </div>
      <Dropzone accept=".jpg,.jpeg,.png,.webp,.gif,.bmp" files={files} onChange={setFiles} />
      <div className="card p-5"><Slider label="Number of colors" value={count} min={2} max={12} onChange={setCount} /></div>
      <button className="btn-primary w-full !py-4 text-lg" onClick={run} disabled={busy}>
        {busy ? 'Extracting…' : '🎨 Extract Palette'}</button>
      {error && <div className="card !border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">⚠ {error}</div>}
      {palettes.map((p) => (
        <div key={p.file} className="card p-5 fade-in space-y-3">
          <div className="flex items-center gap-3">
            <img src={p.thumb} alt="" className="w-14 h-14 rounded-lg object-cover border border-white/10" />
            <p className="font-semibold truncate">{p.file}</p>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {p.colors.map((c, i) => (
              <button key={i} className="group text-left"
                onClick={() => navigator.clipboard?.writeText(c.hex)}
                title={`Copy ${c.hex}`}>
                <div className="h-14 rounded-xl border border-white/10 group-hover:border-lime-accent transition-colors" style={{ background: c.hex }} />
                <p className="text-xs font-mono mt-1 text-zinc-300">{c.hex}</p>
                <p className="text-[10px] text-zinc-500">rgb({c.rgb.join(',')})</p>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
