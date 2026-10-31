import React from 'react';

/* ---------------------------------------------------------------- icons */
const paths = {
  image: <><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="9" cy="9" r="2" /><path d="m21 15-4.5-4.5L7 20" /></>,
  compress: <><path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v4a2 2 0 0 1-2 2H3m6 12H5a2 2 0 0 1-2-2v-4m6 6h10a2 2 0 0 0 2-2v-4M9 21v-4a2 2 0 0 0-2-2H3m18 6v-4a2 2 0 0 0-2-2h-4m-6 6v-4a2 2 0 0 0-2-2" /></>,
  resize: <><path d="M21 3 3 21" /><path d="M21 8V3h-5" /><path d="M3 16v5h5" /><rect x="3" y="3" width="18" height="18" rx="2" opacity=".3" /></>,
  crop: <><path d="M6 2v14a2 2 0 0 0 2 2h14" /><path d="M18 22V8a2 2 0 0 0-2-2H2" /></>,
  rotate: <><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 3v6h-6" /></>,
  merge: <><rect x="3" y="3" width="8" height="8" rx="1" /><rect x="13" y="13" width="8" height="8" rx="1" /><path d="M11 7h6a2 2 0 0 1 2 2v4" /><path d="M13 17H7a2 2 0 0 1-2-2v-4" /></>,
  gif: <><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M7 5v14M17 5v14M2 10h5M2 14h5M17 10h5M17 14h5" /></>,
  convert: <><path d="M4 7h11l-3-3m3 3-3 3" /><path d="M20 17H9l3-3m-3 3 3 3" /></>,
  palette: <><circle cx="13.5" cy="6.5" r=".5" fill="currentColor" /><circle cx="17.5" cy="10.5" r=".5" fill="currentColor" /><circle cx="8.5" cy="7.5" r=".5" fill="currentColor" /><circle cx="6.5" cy="12.5" r=".5" fill="currentColor" /><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.8-.7 1.8-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.8 1.8-1.8H16c3.3 0 6-2.7 6-6 0-4.9-4.5-8-10-8Z" /></>,
  pdf: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M9 13h1.5a1.5 1.5 0 0 1 0 3H9v-6m5 6v-4h1.5M17 19v-6" /></>,
  split: <><path d="M4 4h6v6H4zM14 14h6v6h-6z" /><path d="M14 4h6v6h-6zM4 14h6v6H4z" opacity=".35" /></>,
  watermark: <><path d="M12 3s5 5.5 5 9a5 5 0 0 1-10 0c0-3.5 5-9 5-9Z" /></>,
  lock: <><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
  unlock: <><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 7.5-2" /></>,
  video: <><rect x="2" y="5" width="14" height="14" rx="2" /><path d="m16 10 6-3v10l-6-3z" /></>,
  audio: <><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>,
  transcript: <><path d="M4 6h16M4 12h10M4 18h14" /><path d="M17 15l2 2 3-3" opacity=".6" /></>,
  zip: <><path d="M8 2v4M8 10v4M8 18v4" /><rect x="4" y="2" width="16" height="20" rx="2" /><path d="M12 14h4" opacity=".5" /></>,
  qr: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h3v3M21 14v7h-7M17 21v-3" /></>,
  key: <><circle cx="7.5" cy="15.5" r="4.5" /><path d="m11 12 9-9 2 2-2 2 2 2-3 3-2-2-2 2" /></>,
  home: <><path d="m3 10 9-7 9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M9 22V12h6v10" /></>,
  star: <><path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z" /></>,
};

export function Icon({ name, size = 20, className = '' }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
      className={className}>
      {paths[name] || paths.image}
    </svg>
  );
}

/* ---------------------------------------------------------------- toggle */
export function Toggle({ checked, onChange, label }) {
  return (
    <label className="flex items-center justify-between gap-3 py-1 cursor-pointer select-none">
      <span className="text-sm text-zinc-300">{label}</span>
      <button type="button" role="switch" aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`switch ${checked ? 'switch-on' : 'switch-off'}`}>
        <span className={`switch-knob ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
      </button>
    </label>
  );
}

/* ---------------------------------------------------------------- slider */
export function Slider({ label, value, min = 1, max = 100, onChange, suffix = '' }) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="field-label !mb-0">{label}</span>
        <span className="text-sm font-bold text-lime-accent tabular-nums">{value}{suffix}</span>
      </div>
      <input type="range" min={min} max={max} value={value}
        style={{ '--fill': `${fill}%` }}
        onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

/* ---------------------------------------------------------------- field */
export function Field({ label, children, hint }) {
  return (
    <div>
      <span className="field-label">{label}</span>
      {children}
      {hint && <p className="text-xs text-zinc-500 mt-1">{hint}</p>}
    </div>
  );
}

export function NumInput(props) {
  return <input type="number" className="input" {...props} />;
}

export function Select({ options, ...props }) {
  return (
    <select className="input" {...props}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function Chips({ options, value, multi = false, onChange }) {
  const toggle = (v) => {
    if (multi) {
      const set = new Set(value);
      set.has(v) ? set.delete(v) : set.add(v);
      onChange([...set]);
    } else onChange(v);
  };
  const isOn = (v) => (multi ? value.includes(v) : value === v);
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => toggle(o.value)}
          className={`chip ${isOn(o.value) ? 'chip-on' : 'chip-off'}`}>{o.label}</button>
      ))}
    </div>
  );
}
