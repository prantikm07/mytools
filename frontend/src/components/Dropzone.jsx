import React, { useCallback, useRef, useState } from 'react';
import { fmtBytes } from '../api';
import { Icon } from './ui';

/** Format seconds like 1:05 */
const dur = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export default function Dropzone({ accept, multiple = true, files, onChange, title, subtitle }) {
  const inputRef = useRef(null);
  const [drag, setDrag] = useState(false);
  const [previews, setPreviews] = useState({});

  const addFiles = useCallback((list) => {
    const incoming = Array.from(list).filter((f) =>
      !accept || accept.split(',').some((ext) => f.name.toLowerCase().endsWith(ext.trim()) ||
        (f.type && ext.includes('/') && f.type === ext)));
    if (!incoming.length) return;
    const next = multiple ? [...files, ...incoming] : incoming.slice(0, 1);
    onChange(next);
    // generate thumbnails for images/videos client-side
    incoming.forEach((f) => {
      if (f.type.startsWith('image/')) {
        const url = URL.createObjectURL(f);
        setPreviews((p) => ({ ...p, [f.name + f.size]: url }));
      } else if (f.type.startsWith('video/')) {
        const url = URL.createObjectURL(f);
        const v = document.createElement('video');
        v.preload = 'metadata'; v.src = url; v.muted = true;
        v.addEventListener('loadeddata', () => { v.currentTime = Math.min(1, v.duration / 4); });
        v.addEventListener('seeked', () => {
          const c = document.createElement('canvas');
          c.width = 96; c.height = 54 * (v.videoHeight / v.videoWidth || 1);
          c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
          try {
            setPreviews((p) => ({ ...p, [f.name + f.size]: c.toDataURL() }));
          } catch { /* ignore */ }
          URL.revokeObjectURL(url);
        });
      }
    });
  }, [files, onChange, multiple, accept]);

  const onDrop = (e) => {
    e.preventDefault(); setDrag(false);
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  };

  const removeAt = (i) => onChange(files.filter((_, idx) => idx !== i));

  const move = (i, dir) => {
    const arr = [...files];
    const j = i + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    onChange(arr);
  };

  return (
    <div className="space-y-3">
      <div role="button" tabIndex={0}
        className={`dropzone ${drag ? 'dropzone-active' : ''}`}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}>
        <input ref={inputRef} type="file" hidden accept={accept} multiple={multiple}
          onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
        <div className="flex flex-col items-center gap-2 pointer-events-none">
          <div className="w-14 h-14 rounded-2xl bg-lime-accent/10 border border-lime-accent/30 grid place-items-center text-lime-accent">
            <Icon name="zip" size={26} />
          </div>
          <p className="font-semibold text-zinc-200">{title || 'Drop files here or click to browse'}</p>
          <p className="text-xs text-zinc-500">{subtitle || `Supports batch uploads${accept ? ' · ' + accept : ''}`}</p>
        </div>
      </div>

      {files.length > 0 && (
        <ul className="card divide-y divide-white/5 overflow-hidden fade-in">
          {files.map((f, i) => (
            <li key={f.name + i} className="flex items-center gap-3 px-4 py-2.5 group">
              <div className="w-10 h-10 rounded-lg bg-ink-900 border border-white/10 overflow-hidden grid place-items-center shrink-0">
                {previews[f.name + f.size]
                  ? <img src={previews[f.name + f.size]} alt="" className="w-full h-full object-cover" />
                  : <Icon name={f.name.match(/\.(pdf)$/i) ? 'pdf' : f.name.match(/\.(mp4|mov|mkv|webm|avi)$/i) ? 'video' : 'audio'} size={16} className="text-zinc-500" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-zinc-200">{f.name}</p>
                <p className="text-xs text-zinc-500">{fmtBytes(f.size)}</p>
              </div>
              {multiple && files.length > 1 && (
                <div className="flex opacity-0 group-hover:opacity-100 transition-opacity">
                  <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => move(i, -1)} title="Move up">↑</button>
                  <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => move(i, 1)} title="Move down">↓</button>
                </div>
              )}
              <button onClick={() => removeAt(i)} title="Remove"
                className="text-zinc-500 hover:text-red-400 transition-colors px-2 font-bold">✕</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
