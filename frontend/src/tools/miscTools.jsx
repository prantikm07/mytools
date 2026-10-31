import React, { useEffect, useState } from 'react';
import { API_BASE, fmtBytes, getJSON, postForm } from '../api';
import Dropzone from '../components/Dropzone';
import Workspace from '../components/Workspace';
import { Field, NumInput, Select, Slider, Toggle } from '../components/ui';

/* ============================================================ VIDEO -> AUDIO */
export function VideoToAudio({ tool }) {
  const [files, setFiles] = useState([]);
  const [fmt, setFmt] = useState('mp3');
  const [bitrate, setBitrate] = useState('192');

  const run = async () => {
    const fd = new FormData();
    files.forEach((f) => fd.append('files', f));
    fd.append('fmt', fmt); fd.append('bitrate', bitrate);
    const { blob, filename } = await postForm('/api/media/extract-audio', fd);
    return [{ blob, filename: filename || `audio.${fmt}`, meta: fmtBytes(blob.size) }];
  };

  return (
    <Workspace tool={tool} files={files} setFiles={setFiles}
      DropArea={({ files, onChange }) => <Dropzone accept=".mp4,.mov,.mkv,.webm,.avi,.m4v,.flv,.wmv,.mp3,.wav" files={files} onChange={onChange} />}
      Controls={() => (
        <div className="grid md:grid-cols-2 gap-x-8 gap-y-5">
          <Field label="Output format"><Select value={fmt} onChange={(e) => setFmt(e.target.value)} options={[
            { value: 'mp3', label: 'MP3' }, { value: 'wav', label: 'WAV (lossless)' },
            { value: 'aac', label: 'AAC / M4A' }, { value: 'ogg', label: 'OGG (Vorbis)' },
            { value: 'flac', label: 'FLAC (lossless)' }]} /></Field>
          {(fmt === 'mp3' || fmt === 'aac' || fmt === 'ogg') && (
            <Field label="Bitrate"><Select value={bitrate} onChange={(e) => setBitrate(e.target.value)} options={[
              { value: '128', label: '128 kbps' }, { value: '192', label: '192 kbps' },
              { value: '256', label: '256 kbps' }, { value: '320', label: '320 kbps' }]} /></Field>)}
          <p className="text-xs text-zinc-500 md:col-span-2">Powered by FFmpeg on the server — open source, no external services.</p>
        </div>
      )} run={run} />
  );
}

/* ============================================================ TRANSCRIPT (local faster-whisper) */
export function Transcript({ tool }) {
  const [files, setFiles] = useState([]);
  const [lang, setLang] = useState('');
  const [model, setModel] = useState('base');
  const [status, setStatus] = useState(null);

  useEffect(() => { getJSON('/api/media/transcribe-status').then(setStatus).catch(() => {}); }, []);

  const run = async () => {
    const fd = new FormData();
    fd.append('file', files[0]);
    fd.append('language', lang); fd.append('model_size', model);
    const data = await (async () => {
      const res = await fetch('/api/media/transcribe', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail || json.error || 'Transcription failed');
      return json;
    })();
    const blob = new Blob([data.text], { type: 'text/plain' });
    return [{ blob, filename: (files[0].name.replace(/\.[^.]+$/, '') || 'media') + '-transcript.txt',
      meta: `${data.text.split(/\s+/).filter(Boolean).length} words · detected language: ${data.language || 'auto'}` }];
  };

  return (
    <>
      {status && !status.available && (
        <div className="card !border-yellow-500/40 bg-yellow-500/10 p-4 mb-5 text-sm text-yellow-200 max-w-5xl mx-auto">
          ⚠ Local Whisper engine not installed yet. Run <code className="bg-black/40 px-1.5 py-0.5 rounded font-mono">pip install faster-whisper</code> on the server (free & open source — see README), then restart the backend.
        </div>
      )}
      <Workspace tool={tool} files={files} setFiles={setFiles}
        DropArea={({ files, onChange }) => <Dropzone accept=".mp4,.mov,.mkv,.webm,.avi,.mp3,.wav,.m4a,.flac,.ogg" multiple={false} files={files} onChange={onChange} />}
        Controls={() => (
          <div className="grid md:grid-cols-2 gap-x-8 gap-y-5">
            <Field label="Language"><Select value={lang} onChange={(e) => setLang(e.target.value)} options={[
              { value: '', label: 'Auto-detect' }, { value: 'en', label: 'English' }, { value: 'es', label: 'Spanish' },
              { value: 'fr', label: 'French' }, { value: 'de', label: 'German' }, { value: 'ar', label: 'Arabic' },
              { value: 'zh', label: 'Chinese' }, { value: 'hi', label: 'Hindi' }, { value: 'pt', label: 'Portuguese' },
              { value: 'ru', label: 'Russian' }, { value: 'ja', label: 'Japanese' }]} /></Field>
            <Field label="Whisper model size" hint="Bigger = more accurate but slower (CPU int8)">
              <Select value={model} onChange={(e) => setModel(e.target.value)} options={[
                { value: 'tiny', label: 'tiny (~1 GB RAM)' }, { value: 'base', label: 'base (recommended)' },
                { value: 'small', label: 'small' }, { value: 'medium', label: 'medium' }]} /></Field>
            <p className="text-xs text-zinc-500 md:col-span-2">Runs entirely on your own server with faster-whisper (open-source CTranslate2 port of OpenAI Whisper). No paid APIs.</p>
          </div>
        )} run={run} />
    </>
  );
}

/* ============================================================ ZIP maker / extractor (100% client-side via JSZip) */
export function ZipTool({ tool }) {
  const [files, setFiles] = useState([]);
  const [compression, setCompression] = useState('DEFLATE');
  const [level, setLevel] = useState(6);

  const run = async () => {
    const { default: JSZip } = await import('jszip');
    if (tool.id === 'zip') {
      const zip = new JSZip();
      const used = new Set();
      files.forEach((f) => {
        let name = f.name;
        let i = 1;
        while (used.has(name)) {
          const m = /^(.*?)(\.[^.]*)?$/.exec(f.name);
          name = `${m[1]}(${i})${m[2] || ''}`; i++;
        }
        used.add(name);
        zip.file(name, f);
      });
      const blob = await zip.generateAsync({
        type: 'blob', compression, compressionOptions: { level },
      });
      return [{ blob, filename: 'prymo-archive.zip', meta: fmtBytes(blob.size) }];
    }
    // unzip — with zip-slip-safe names (JSZip sanitizes "../" by default)
    const zip = await JSZip.loadAsync(files[0]);
    const entries = Object.values(zip.files).filter((e) => !e.dir);
    if (!entries.length) throw new Error('ZIP archive is empty');
    const out = [];
    for (const e of entries) {
      const blob = await e.async('blob');
      out.push({ blob, filename: e.name.split('/').pop() || 'file.bin' });
    }
    const total = out.reduce((a, r) => a + r.blob.size, 0);
    if (out.length === 1) return [{ ...out[0], meta: fmtBytes(total) }];
    return [{ blob: null, bundle: out, filename: 'extracted.zip', meta: `${out.length} files · ${fmtBytes(total)}` }];
  };

  return (
    <Workspace tool={tool} files={files} setFiles={setFiles}
      DropArea={({ files, onChange }) => <Dropzone
        accept={tool.id === 'unzip' ? '.zip' : undefined}
        multiple={tool.id === 'zip'} files={files} onChange={onChange}
        title={tool.id === 'zip' ? 'Drop any files to bundle into a ZIP' : 'Drop a .zip to extract all contents'} />}
      Controls={() => tool.id === 'zip' ? (
        <div className="grid md:grid-cols-2 gap-x-8 gap-y-5">
          <Field label="Compression method"><Select value={compression} onChange={(e) => setCompression(e.target.value)} options={[
            { value: 'stored', label: 'None (store only)' }, { value: 'deflate', label: 'DEFLATE (standard)' },
            { value: 'bzip2', label: 'BZIP2 (smaller, slower)' }, { value: 'lzma', label: 'LZMA (smallest, slowest)' }]} /></Field>
          <Slider label="Compression level" value={level} min={0} max={9} onChange={setLevel} />
        </div>
      ) : <p className="text-sm text-zinc-500">All files inside the archive are extracted (with zip-slip protection) and returned as a clean ZIP.</p>}
      run={run} />
  );
}

/* ============================================================ QR / BARCODE GENERATOR */
export function CodeGenerator({ tool }) {
  const [kind, setKind] = useState('qr');
  const [text, setText] = useState('https://example.com');
  const [size, setSize] = useState(8);
  const [fg, setFg] = useState('#a3e635');
  const [bg, setBg] = useState('#000000');
  const [symbology, setSymbology] = useState('code128');
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const generate = async () => {
    setError(''); setResults(null);
    if (!text.trim()) { setError('Enter some text or a URL.'); return; }
    setBusy(true);
    try {
      const qs = new URLSearchParams();
      let path;
      if (kind === 'qr') {
        path = '/api/utils/qr';
        qs.set('text', text); qs.set('size', size); qs.set('fg', fg); qs.set('bg', bg); qs.set('fmt', 'png');
      } else {
        path = '/api/utils/barcode';
        qs.set('text', text); qs.set('symbology', symbology); qs.set('fmt', 'png');
      }
      const res = await fetch(`${API_BASE}${path}?${qs.toString()}`);
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try { detail = (await res.json()).detail || detail; } catch { /* ignore */ }
        throw new Error(detail);
      }
      const cd = res.headers.get('content-disposition') || '';
      const m = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
      const filename = m ? decodeURIComponent(m[1]) : (kind === 'qr' ? 'qr-code.png' : 'barcode.png');
      const blob = await res.blob();
      setResults({ blob, filename });
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="fade-in max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-2xl bg-lime-accent/10 border border-lime-accent/30 grid place-items-center text-lime-accent">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h3v3M21 14v7h-7M17 21v-3" /></svg>
        </div>
        <div><h1 className="text-2xl font-extrabold text-white">{tool.name}</h1>
          <p className="text-sm text-zinc-500">{tool.desc}</p></div>
      </div>

      <div className="card p-5 space-y-5">
        <div className="flex gap-2">
          <button className={`chip ${kind === 'qr' ? 'chip-on' : 'chip-off'}`} onClick={() => setKind('qr')}>QR Code</button>
          <button className={`chip ${kind === 'barcode' ? 'chip-on' : 'chip-off'}`} onClick={() => setKind('barcode')}>Barcode</button>
        </div>
        <Field label="Text / URL / Data">
          <textarea className="input min-h-[70px]" value={text} onChange={(e) => setText(e.target.value)} /></Field>
        <div className="grid md:grid-cols-2 gap-x-8 gap-y-5">
          {kind === 'qr' ? (<>
            <Slider label="Module scale" value={size} min={2} max={20} onChange={setSize} />
            <div className="flex gap-6">
              <Field label="Foreground"><input type="color" value={fg} onChange={(e) => setFg(e.target.value)} className="h-10 w-16 rounded-lg bg-transparent border border-white/10 cursor-pointer" /></Field>
              <Field label="Background"><input type="color" value={bg} onChange={(e) => setBg(e.target.value)} className="h-10 w-16 rounded-lg bg-transparent border border-white/10 cursor-pointer" /></Field>
            </div>
          </>) : (
            <Field label="Symbology"><Select value={symbology} onChange={(e) => setSymbology(e.target.value)} options={[
              { value: 'code128', label: 'Code 128 (any ASCII)' }, { value: 'code39', label: 'Code 39' },
              { value: 'ean13', label: 'EAN-13 (12 digits)' }, { value: 'ean8', label: 'EAN-8 (7 digits)' },
              { value: 'upca', label: 'UPC-A (11 digits)' }, { value: 'itf', label: 'ITF interleaved' }]} /></Field>
          )}
        </div>
      </div>

      <button className="btn-primary w-full !py-4 text-lg" onClick={generate} disabled={busy}>
        {busy ? 'Generating…' : '⚡ Generate'}</button>
      {error && <div className="card !border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">⚠ {error}</div>}
      {results && (
        <div className="card p-6 flex flex-col sm:flex-row items-center gap-6 fade-in">
          <img src={URL.createObjectURL(results.blob)} alt="generated code"
            className="max-h-64 rounded-xl bg-white p-3 shadow-inner" />
          <div className="space-y-3 text-center sm:text-left">
            <p className="font-bold text-white">{results.filename}</p>
            <p className="text-xs text-zinc-500">{fmtBytes(results.blob.size)}</p>
            <a className="btn-primary !px-4 !py-2 text-sm" href={URL.createObjectURL(results.blob)} download={results.filename}>⬇ Download PNG</a>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================ PASSWORD GENERATOR (client-side crypto) */
export function PasswordGen({ tool }) {
  const [length, setLength] = useState(16);
  const [opts, setOpts] = useState({ upper: true, lower: true, digits: true, symbols: true, noAmbig: true });
  const [out, setOut] = useState(null);

  const generate = () => {
    const sets = [];
    if (opts.upper) sets.push('ABCDEFGHJKLMNPQRSTUVWXYZ');
    if (opts.lower) sets.push('abcdefghijkmnpqrstuvwxyz');
    if (opts.digits) sets.push('23456789');
    if (opts.symbols) sets.push('!@#$%^&*()-_=+[]{};:,.<>?/~');
    let pool = sets.join('');
    if (!opts.noAmbig) {
      pool += opts.upper ? 'IO' : '';
      pool += opts.lower ? 'l' : '';
      pool += opts.digits ? '01' : '';
    }
    if (!pool) return;
    const arr = new Uint32Array(length);
    crypto.getRandomValues(arr);
    let pwd = '';
    for (let i = 0; i < length; i++) pwd += pool[arr[i] % pool.length];
    // guarantee at least one of each selected class
    const missing = sets.filter((s) => !pwd.includes(...[...s].slice(0, 0)) && ![...s].some((c) => pwd.includes(c)));
    const pos = new Uint32Array(missing.length);
    crypto.getRandomValues(pos);
    let chars = [...pwd];
    missing.forEach((s, i) => {
      const idx = pos[i] % chars.length;
      const pick = new Uint32Array(1); crypto.getRandomValues(pick);
      chars[idx] = s[pick[0] % s.length];
    });
    setOut({ pwd: chars.join(''), entropy: Math.round(length * Math.log2(pool.length) * 10) / 10 });
  };

  useEffect(() => { generate(); /* eslint-disable-next-line */ }, []);

  const strength = out ? (out.entropy > 90 ? ['Very strong', 'bg-lime-accent'] :
    out.entropy > 60 ? ['Strong', 'bg-lime-deep'] : out.entropy > 40 ? ['Fair', 'bg-yellow-500'] : ['Weak', 'bg-red-500']) : null;

  return (
    <div className="fade-in max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-2xl bg-lime-accent/10 border border-lime-accent/30 grid place-items-center text-lime-accent">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="7.5" cy="15.5" r="4.5" /><path d="m11 12 9-9 2 2-2 2 2 2-3 3-2-2-2 2" /></svg>
        </div>
        <div><h1 className="text-2xl font-extrabold text-white">{tool.name}</h1>
          <p className="text-sm text-zinc-500">{tool.desc} · generated locally with WebCrypto</p></div>
      </div>

      {out && (
        <div className="card p-5 select-all">
          <p className="font-mono text-xl break-all text-lime-accent">{out.pwd}</p>
          <div className="mt-3 h-2 rounded-full bg-zinc-800 overflow-hidden">
            <div className={`h-full ${strength[1]}`} style={{ width: `${Math.min(100, out.entropy / 1.2)}%` }} />
          </div>
          <div className="flex justify-between mt-2 text-xs text-zinc-500">
            <span>{strength[0]} · {out.entropy} bits entropy</span>
            <button className="text-lime-accent hover:underline"
              onClick={() => navigator.clipboard?.writeText(out.pwd)}>Copy</button>
          </div>
        </div>
      )}

      <div className="card p-5 space-y-5">
        <Slider label="Length" value={length} min={6} max={64} onChange={setLength} />
        <div className="grid sm:grid-cols-2 gap-x-8">
          <Toggle checked={opts.upper} onChange={(v) => setOpts({ ...opts, upper: v })} label="Uppercase (A–Z)" />
          <Toggle checked={opts.lower} onChange={(v) => setOpts({ ...opts, lower: v })} label="Lowercase (a–z)" />
          <Toggle checked={opts.digits} onChange={(v) => setOpts({ ...opts, digits: v })} label="Digits (0–9)" />
          <Toggle checked={opts.symbols} onChange={(v) => setOpts({ ...opts, symbols: v })} label="Symbols (!@#$…)" />
        </div>
        <Toggle checked={opts.noAmbig} onChange={(v) => setOpts({ ...opts, noAmbig: v })} label="Avoid ambiguous characters (l, I, O, 0, 1)" />
      </div>

      <button className="btn-primary w-full !py-4 text-lg" onClick={generate}>🎲 Generate Password</button>
    </div>
  );
}
