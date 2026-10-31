// Shared API helpers for prymo ToolBox backend.
//
// On Netlify (or any static host) set VITE_API_URL at build time to point the
// SPA at a deployed FastAPI backend, e.g. https://prymo-api.onrender.com
// When unset, requests go to same-origin /api (FastAPI serving the SPA, or
// the Vite dev proxy, or the Netlify Function rewrite).
export const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');

const apiUrl = (path) => (API_BASE ? `${API_BASE}${path}` : path);

export function fmtBytes(n) {
  if (!Number.isFinite(n)) return '—';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${u[i]}`;
}

/** POST multipart form and receive the response as a Blob download descriptor. */
export async function postForm(path, formData) {
  const res = await fetch(apiUrl(path), { method: 'POST', body: formData });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const ct = res.headers.get('content-type') || '';
      detail = ct.includes('json') ? (await res.json()).detail || detail : await res.text() || detail;
    } catch { /* ignore */ }
    throw new Error(detail);
  }
  const cd = res.headers.get('content-disposition') || '';
  const m = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  const filename = m ? decodeURIComponent(m[1]) : 'download';
  const blob = await res.blob();
  return { blob, filename };
}

export async function getJSON(path) {
  const res = await fetch(apiUrl(path));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Download multiple results; if >1, bundle into one ZIP via JSZip.
 *  Entries with a `bundle` array (unzipped contents) expand into the ZIP. */
export async function downloadResults(results) {
  const flat = [];
  for (const r of results) {
    if (Array.isArray(r.bundle)) flat.push(...r.bundle);
    else flat.push({ blob: r.blob, filename: r.filename });
  }
  if (flat.length === 1) {
    saveBlob(flat[0].blob, flat[0].filename);
    return;
  }
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  flat.forEach((r, i) => {
    let name = r.filename;
    if (zip.files[name]) name = name.replace(/(\.[^.]+)?$/, `-${i}$1`);
    zip.file(name, r.blob);
  });
  const blob = await zip.generateAsync({ type: 'blob' });
  saveBlob(blob, 'prymo-batch.zip');
}
