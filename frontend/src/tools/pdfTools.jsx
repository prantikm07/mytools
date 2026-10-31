import React, { useState } from 'react';
import { fmtBytes, postForm } from '../api';
import Dropzone from '../components/Dropzone';
import Workspace from '../components/Workspace';
import { Chips, Field, NumInput, Select, Slider, Toggle } from '../components/ui';

/* ============================================================ ADVANCED PDF COMPRESSOR */
export function PdfCompressor({ tool }) {
  const [files, setFiles] = useState([]);
  const [preset, setPreset] = useState('');
  const [dpi, setDpi] = useState(150);
  const [quality, setQuality] = useState(60);
  const [gray, setGray] = useState(false);
  const [flatten, setFlatten] = useState(false);

  const run = async () => {
    const fd = new FormData();
    fd.append('file', files[0]);
    fd.append('preset', preset);
    fd.append('dpi', dpi);
    fd.append('quality', quality);
    fd.append('grayscale', gray);
    fd.append('flatten', flatten);
    const { blob, filename } = await postForm('/api/pdf/compress', fd);
    return [{ blob, filename: filename || 'compressed.pdf',
      meta: `${fmtBytes(files[0].size)} → ${fmtBytes(blob.size)} (${Math.max(0, 100 - Math.round((blob.size / files[0].size) * 100))}% saved)` }];
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
          <p className="text-xs text-zinc-500">Engine: Ghostscript when available on the server, otherwise PyMuPDF re-encoding. The output is never larger than the input.</p>
        </div>
      )} run={run} />
  );
}

/* ============================================================ generic single-file PDF tools */
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

  const path = { merge: '/api/pdf/merge', split: '/api/pdf/split', rotate: '/api/pdf/rotate',
    pdf2img: '/api/pdf/to-images', img2pdf: '/api/pdf/from-images',
    protect: '/api/pdf/protect', unlock: '/api/pdf/unlock' }[tool.id];

  const run = async () => {
    const fd = new FormData();
    if (['merge', 'img2pdf'].includes(tool.id)) files.forEach((f) => fd.append('files', f));
    else fd.append('file', files[0]);
    if (tool.id === 'split') { fd.append('mode', mode); fd.append('ranges', ranges); fd.append('every', every); }
    if (tool.id === 'rotate') { fd.append('angle', angle); fd.append('pages_spec', pagesSpec); }
    if (tool.id === 'pdf2img') { fd.append('fmt', fmt); fd.append('dpi', dpi); }
    if (tool.id === 'img2pdf') fd.append('page_size', pageSize);
    if (['protect', 'unlock'].includes(tool.id)) fd.append('password', password);
    const { blob, filename } = await postForm(path, fd);
    return [{ blob, filename: filename || 'result.pdf', meta: fmtBytes(blob.size) }];
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
    protect: () => <Field label="Password" hint="AES-256 via qpdf when installed, else pypdf">
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

/* ============================================================ PDF WATERMARK */
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
    const fd = new FormData();
    fd.append('file', files[0]);
    fd.append('opacity', (opacity / 100).toFixed(2));
    fd.append('size', size); fd.append('position', position);
    fd.append('color', color); fd.append('rotate_deg', rotation);
    if (kind === 'text') fd.append('text', text);
    else if (wmImage) fd.append('image', wmImage);
    else throw new Error('Choose a watermark image first.');
    const { blob, filename } = await postForm('/api/pdf/watermark', fd);
    return [{ blob, filename: filename || 'watermarked.pdf', meta: fmtBytes(blob.size) }];
  };

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
        </div>
      )} run={run} />
  );
}
