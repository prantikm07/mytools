// Shared API helpers for prymo ToolBox backend.

export function fmtBytes(n) {
  if (!Number.isFinite(n)) return '—';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${u[i]}`;
}

/** POST multipart form and receive the response as a Blob download descriptor. */
export async function postForm(path, formData) {
  const res = await fetch(path, { method: 'POST', body: formData });
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
  const res = await fetch(path);
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

/** Download multiple results; if >1, bundle into one ZIP via JSZip. */
export async function downloadResults(results) {
  if (results.length === 1) {
    saveBlob(results[0].blob, results[0].filename);
    return;
  }
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  results.forEach((r, i) => {
    let name = r.filename;
    if (zip.files[name]) name = name.replace(/(\.[^.]+)?$/, `-${i}$1`);
    zip.file(name, r.blob);
  });
  const blob = await zip.generateAsync({ type: 'blob' });
  saveBlob(blob, 'prymo-batch.zip');
}
