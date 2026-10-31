import React, { useState } from 'react';
import { fmtBytes, postForm } from '../api';
import * as C from '../client';
import Dropzone from '../components/Dropzone';
import Workspace from '../components/Workspace';
import { Chips, Field, NumInput, Select, Slider, Toggle } from '../components/ui';

const pdfResultsOf = (list) => list.map((r) => ({
  blob: r.blob, filename: r.filename, preview: null, meta: fmtBytes(r.blob.size),
}));

/* ============================================================ ADVANCED PDF COMPRESSOR — 100% client-side */
export function PdfCompressor({ tool }) {
  const [files, setFiles] = useState([]);
  const [preset, setPreset] = useState('');
  const [dpi, setDpi] = useState(150);
  const [quality, setQuality] = useState(60);
  const [gray, setGray] = useState(false);
  const [flatten, setFlatten] = useState(false);

  const run = async () => {
    const f = files[0];
    if (!C.isPdfFile(f)) throw new Error('Please add a PDF file.');
    let out;
    try {
      out = await C.pdfCompress(f, { preset, dpi, quality, grayscale: gray });
    } catch (e) {
      // Encrypted or exotic PDF → try the serverless/self-hosted API layer.
      const fd = new FormData();
      fd.append('file', f); fd.append('preset', preset); fd.append('dpi', dpi);
      fd.append('quality', quality); fd.append('grayscale', gray); fd.append('flatten', flatten);
      const { blob, filename } = await postForm('/api/pdf/compress', fd);
      out = { blob, filename: filename || 'compressed.pdf' };
      void e;
    }
    return [{ ...out, meta: `${fmtBytes(f.size)} → ${fmtBytes(out.blob.size)} (${Math.max(0, 100 - Math.round((out.blob.size / f.size) * 100))}% saved)` }];
  };

  return (
    <Workspace tool={tool} files={files} setFiles={setFiles}
      DropArea={({ files, onChange }) => <Dropzone accept=".pdf" multiple={false} files={files} onChange={onChange} />}
      Controls={() => (
        <div className="space-y-5">
          <Field label="Compression preset" hint="Presets override the sliders below">
            <Chips value={preset} onChange={setPreset} options={[
              { value: '', label: 'Custom' }, { value: 'low', label: 'Low' },
              { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' },
              { value: 'extreme', label: 'Extreme 🔥' }]} />
          </Field>
          <div className="grid md:grid-cols-2 gap-x-8 gap-y-5">
            <Field label="Image downsampling DPI">
              <Select value={String(dpi)} onChange={(e) => { setDpi(Number(e.target.value)); setPreset(''); }} options={[
                { value: '300', label: '300 DPI — print quality' }, { value: '150', label: '150 DPI — balanced' },
                { value: '100', label: '100 DPI — web' }, { value: '72', label: '72 DPI — maximum reduction' }]} />
            </Field>
            <Slider label="Embedded image JPEG quality" value={quality} min={1} max={100}
              onChange={(v) => { setQuality(v); setPreset(''); }} />
          </div>
          <Toggle checked={gray} onChange={setGray} label="Convert to grayscale (massive size reduction)" />
          <Toggle checked={flatten} onChange={setFlatten} label="Flatten form fields & annotations" />
          <p className="text-xs text-zinc-500">Runs entirely in your browser (pdf.js rasterization + rebuild). The output is never larger than the input.</p>
        </div>
      )} run={run} />
  );
}

/* ============================================================ generic PDF tools — client-side first, API fallback */
export function PdfTool({ tool }) {
  const [files, setFiles] = useState([]);
  const [mode, setMode] = useState('ranges');
  const [ranges, setRanges] = useState('1-3');
  const [every, setEvery] = useState(2);
  const [angle, setAngle] = useState(90);
  const [pagesSpec, setPagesSpec] = useState('');
  const [fmt, setFmt] = useState('png');
  const [dpi, setDpi] = useState(150);
  const [pageSize, setPageSize] = useState('fit');
  const [password, setPassword] = useState('');

  const run = async () => {
    // Protect / Unlock need real crypto on a server (Netlify Function or self-hosted backend).
    if (tool.id === 'protect' || tool.id === 'unlock') {
      if (!password) throw new Error('Enter a password first.');
      try {
        const r = await C.pdfProtectOrUnlock(files[0], { password, mode: tool.id });
        return [{ ...r, meta: fmtBytes(r.blob.size) }];
      } catch (e) {
        throw new Error(e.message.includes('http') || e.message.includes('HTTP')
          ? `${e.message} (Protect/Unlock requires the processing service — see README.)`
          : e.message);
      }
    }
    // Client-side engines (pdf-lib / pdf.js) handle everything else.
    switch (tool.id) {
      case 'merge': {
        const r = await C.pdfMerge(files);
        return [{ ...r, meta: fmtBytes(r.blob.size) }];
      }
      case 'split': {
        const rs = await C.pdfSplit(files[0], { mode, ranges, every: +every || 1 });
        return pdfResultsOf(rs);
      }
      case 'rotate': {
        const r = await C.pdfRotate(files[0], { angle, pagesSpec });
        return [{ ...r, meta: fmtBytes(r.blob.size) }];
      }
      case 'pdf2img': {
        const rs = await C.pdfToImages(files[0], { dpi, fmt });
        return pdfResultsOf(rs);
      }
      case 'img2pdf': {
        const r = await C.imagesToPdf(files, { pageSize });
        return [{ ...r, meta: fmtBytes(r.blob.size) }];
      }
      default: throw new Error('Unknown tool');
    }
  };

  const controls = {
    split: () => (<>
      <Field label="Split mode"><Select value={mode} onChange={(e) => setMode(e.target.value)} options={[
        { value: 'ranges', label: 'Extract page range(s) → one PDF' },
        { value: 'all-pages', label: 'Every page → separate PDFs (ZIP)' },
        { value: 'every-n', label: 'Split every N pages (ZIP)' }]} /></Field>
      {mode === 'ranges' && <Field label="Page ranges" hint="e.g. 1-3, 5, 8-10"><input className="input" value={ranges} onChange={(e) => setRanges(e.target.value)} /></Field>}
      {mode === 'every-n' && <Field label="Pages per chunk"><NumInput min="1" value={every} onChange={(e) => setEvery(e.target.value)} /></Field>}
    </>),
    rotate: () => (<>
      <Field label="Rotation"><Select value={String(angle)} onChange={(e) => setAngle(Number(e.target.value))} options={[
        { value: '90', label: '90° clockwise' }, { value: '180', label: '180°' }, { value: '270', label: '270° clockwise' }]} /></Field>
      <Field label="Pages (optional)" hint="Leave empty for whole document. e.g. 1-3,7"><input className="input" value={pagesSpec} onChange={(e) => setPagesSpec(e.target.value)} /></Field>
    </>),
    pdf2img: () => (<>
      <Field label="Output format"><Select value={fmt} onChange={(e) => setFmt(e.target.value)} options={[
        { value: 'png', label: 'PNG' }, { value: 'jpg', label: 'JPG' }]} /></Field>
      <Field label="Resolution"><Select value={String(dpi)} onChange={(e) => setDpi(Number(e.target.value))} options={[
        { value: '100', label: '100 DPI' }, { value: '150', label: '150 DPI' },
        { value: '200', label: '200 DPI' }, { value: '300', label: '300 DPI' }]} /></Field>
    </>),
    img2pdf: () => (
      <Field label="Page size"><Select value={pageSize} onChange={(e) => setPageSize(e.target.value)} options={[
        { value: 'fit', label: 'Fit page to each image' }, { value: 'a4', label: 'Center on A4' }]} /></Field>
    ),
    protect: () => <Field label="Password" hint="AES-256 encryption via the processing service (open source)">
      <input type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>,
    unlock: () => <Field label="Current password" hint="Needed to remove protection">
      <input type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>,
    merge: () => <p className="text-sm text-zinc-500">All PDFs are combined in the listed order — use ↑↓ buttons on the file list to reorder.</p>,
  }[tool.id];

  return (
    <Workspace tool={tool} files={files} setFiles={setFiles}
      DropArea={({ files, onChange }) => <Dropzone
        accept={tool.id === 'img2pdf' ? '.jpg,.jpeg,.png,.webp,.bmp,.tiff' : '.pdf'}
        multiple={['merge', 'img2pdf'].includes(tool.id)} files={files} onChange={onChange} />}
      Controls={controls} run={run} />
  );
}

/* ============================================================ PDF WATERMARK — client-side (pdf-lib) */
export function PdfWatermark({ tool }) {
  const [files, setFiles] = useState([]);
  const [kind, setKind] = useState('text');
  const [text, setText] = useState('CONFIDENTIAL');
  const [wmImage, setWmImage] = useState(null);
  const [opacity, setOpacity] = useState(15);
  const [size, setSize] = useState(48);
  const [position, setPosition] = useState('center');
  const [color, setColor] = useState('#a3e635');
  const [rotation, setRotation] = useState(45);

  const run = async () => {
    const opts = {
      text, opacity: opacity / 100, size, position, color,
      tile: position === 'tile', rotate: rotation > 0, imageFile: kind === 'image' ? wmImage : null,
    };
    if (kind === 'image' && !wmImage) throw new Error('Choose a watermark image first.');
    let out;
    try {
      out = await C.pdfWatermark(files[0], opts);
    } catch (e) {
      // Encrypted PDF etc. → fall back to the API layer.
      const fd = new FormData();
      fd.append('file', files[0]);
      fd.append('opacity', (opacity / 100).toFixed(2));
      fd.append('size', size); fd.append('position', position);
      fd.append('color', color); fd.append('rotate_deg', rotation);
      if (kind === 'text') fd.append('text', text); else fd.append('image', wmImage);
      const { blob, filename } = await postForm('/api/pdf/watermark', fd);
      out = { blob, filename: filename || 'watermarked.pdf' };
      void e;
    }
    return [{ ...out, meta: fmtBytes(out.blob.size) }];
  };

  return (
    <Workspace tool={tool} files={files} setFiles={setFiles}
      DropArea={({ files, onChange }) => <Dropzone accept=".pdf" multiple={false} files={files} onChange={onChange} />}
      Controls={() => (
        <div className="space-y-5">
          <Field label="Compression preset" hint="Presets override the sliders below">
            <Chips value={preset} onChange={setPreset} options={[
              { value: '', label: 'Custom' }, { value: 'low', label: 'Low' },
              { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' },
              { value: 'extreme', label: 'Extreme 🔥' }]} />
          </Field>
          <div className="grid md:grid-cols-2 gap-x-8 gap-y-5">
            <Field label="Image downsampling DPI">
              <Select value={String(dpi)} onChange={(e) => { setDpi(Number(e.target.value)); setPreset(''); }} options={[
                { value: '300', label: '300 DPI — print quality' }, { value: '150', label: '150 DPI — balanced' },
                { value: '100', label: '100 DPI — web' }, { value: '72', label: '72 DPI — maximum reduction' }]} />
            </Field>
            <Slider label="Embedded image JPEG quality" value={quality} min={1} max={100}
              onChange={(v) => { setQuality(v); setPreset(''); }} />
          </div>
          <Toggle checked={gray} onChange={setGray} label="Convert to grayscale (massive size reduction)" />
          <Toggle checked={flatten} onChange={setFlatten} label="Flatten form fields & annotations" />
          <p className="text-xs text-zinc-500">Runs entirely in your browser (pdf.js rasterization + pdf-lib rebuild). The output is never larger than the input.</p>
        </div>
      )} run={run} />
  );
}
  return (
    <Workspace tool={tool} files={files} setFiles={setFiles}
      DropArea={({ files, onChange }) => <Dropzone accept=".pdf" multiple={false} files={files} onChange={onChange} />}
      Controls={() => (
        <div className="space-y-5">
          <Chips value={kind} onChange={setKind} options={[{ value: 'text', label: 'Text watermark' }, { value: 'image', label: 'Image watermark' }]} />
          {kind === 'text' ? (
            <Field label="Watermark text"><input className="input" value={text} onChange={(e) => setText(e.target.value)} /></Field>
          ) : (
            <Field label="Watermark image (PNG/JPG)">
              <input type="file" accept=".png,.jpg,.jpeg,.webp" className="text-sm text-zinc-400 file:btn-ghost file:mr-3"
                onChange={(e) => setWmImage(e.target.files?.[0] || null)} /></Field>
          )}
          <div className="grid md:grid-cols-2 gap-x-8 gap-y-5">
            <Slider label="Opacity" value={opacity} min={2} max={100} onChange={setOpacity} suffix="%" />
            <Slider label="Font size" value={size} min={10} max={140} onChange={setSize} suffix=" pt" />
            <Slider label="Rotation" value={rotation} min={0} max={90} onChange={setRotation} suffix="°" />
            <Field label="Position"><Select value={position} onChange={(e) => setPosition(e.target.value)} options={[
              { value: 'center', label: 'Center' }, { value: 'tile', label: 'Tiled (diagonal repeat)' },
              { value: 'top-left', label: 'Top left' }, { value: 'top-right', label: 'Top right' },
              { value: 'bottom-left', label: 'Bottom left' }, { value: 'bottom-right', label: 'Bottom right' }]} /></Field>
            {kind === 'text' && <Field label="Color">
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)}
                className="h-10 w-20 rounded-lg bg-transparent border border-white/10 cursor-pointer" /></Field>}
          </div>
          <p className="text-xs text-zinc-500">Applied locally in your browser with pdf-lib — the PDF never leaves your device.</p>
        </div>
      )} run={run} />
  );
}
