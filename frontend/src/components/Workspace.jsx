import React, { useState } from 'react';
import { Icon } from './ui';
import { downloadResults } from '../api';

/**
 * Generic tool workspace: header + dropzone slot + controls slot +
 * Process button + results list. Each tool supplies `renderControls`,
 * `onProcess(files, controlsState)` and gets results rendered with
 * per-file download plus "Download all as ZIP".
 */
export default function Workspace({ tool, files, setFiles, DropArea, Controls, run }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState([]);

  const process = async () => {
    setError(''); setResults([]);
    if (!files.length) { setError('Add at least one file first.'); return; }
    setBusy(true);
    try {
      const out = await run(files);
      // attach object URLs once (stable across renders)
      (out || []).forEach((r) => { r.url = URL.createObjectURL(r.blob); });
      setResults(out || []);
    } catch (e) {
      setError(e.message || 'Processing failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fade-in max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-2xl bg-lime-accent/10 border border-lime-accent/30 grid place-items-center text-lime-accent shrink-0">
          <Icon name={tool.icon} size={24} />
        </div>
        <div>
          <h1 className="text-2xl font-extrabold text-white">{tool.name}</h1>
          <p className="text-sm text-zinc-500">{tool.desc}</p>
        </div>
      </div>

      <DropArea files={files} onChange={setFiles} />

      <div className="card p-5 space-y-4">
        <h2 className="text-sm font-bold uppercase tracking-widest text-lime-accent">Options</h2>
        <Controls />
      </div>

      <button className="btn-primary w-full !py-4 text-lg" onClick={process} disabled={busy}>
        {busy ? (<><span className="spin inline-block w-5 h-5 rounded-full border-2 border-ink-950/30 border-t-ink-950" /> Processing…</>)
              : (<><Icon name="star" size={20} /> Process</>)}
      </button>

      {error && (
        <div className="card !border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300 fade-in">⚠ {error}</div>
      )}

      {results.length > 0 && (
        <div className="card overflow-hidden fade-in">
          <div className="px-5 py-3 border-b border-white/5 flex items-center justify-between">
            <span/>
            <h2 className="font-bold text-white">Results ({results.length})</h2>
          </div>
          <ul className="divide-y divide-white/5">
            {results.map((r, i) => (
              <li key={i} className="flex items-center gap-3 px-5 py-3">
                <div className="w-10 h-10 rounded-lg overflow-hidden bg-ink-900 grid place-items-center shrink-0 border border-white/10">
                  {r.preview ? <img src={r.preview} alt="" className="w-full h-full object-cover" />
                             : <Icon name="audio" size={16} className="text-zinc-500" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{r.filename}</p>
                  <p className="text-xs text-zinc-500">{r.meta || `${(r.blob.size / 1024).toFixed(0)} KB`}</p>
                </div>
                <a className="btn-ghost text-xs" href={r.url} download={r.filename}>
                  ⬇ Download
                </a>
              </li>
            ))}
          </ul>
          {results.length > 1 && (
            <div className="p-4 border-t border-white/5">
              <button className="btn-primary w-full !py-3 text-sm" onClick={() => downloadResults(results)}>
                ⬇ Download all as ZIP ({results.length} files)
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
