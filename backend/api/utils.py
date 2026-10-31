"""Utilities: ZIP create/extract, QR & barcode generation, password generator."""
from __future__ import annotations

import io
import os
import secrets
import string
import zipfile

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response

from ..storage import new_job_dir, safe_join

router = APIRouter(prefix="/api/utils", tags=["utils"])


# ---------------------------------------------------------------- zip maker
@router.post("/zip")
async def make_zip(files: list[UploadFile] = File(...), compression: str = Form("deflate"),
                   level: int = Form(6)):
    job = new_job_dir()
    out = safe_join(job, "archive.zip")
    comp = {"stored": zipfile.ZIP_STORED, "deflate": zipfile.ZIP_DEFLATED,
            "bzip2": zipfile.ZIP_BZIP2, "lzma": zipfile.ZIP_LZMA}.get(compression, zipfile.ZIP_DEFLATED)
    used_names: set[str] = set()
    with zipfile.ZipFile(out, "w", comp, compresslevel=max(0, min(9, level))) as zf:
        for f in files:
            name = os.path.basename(f.filename or "file.bin")
            stem, ext = os.path.splitext(name)
            i = 1
            while name in used_names:
                name = f"{stem}({i}){ext}"
                i += 1
            used_names.add(name)
            zf.writestr(name, await f.read())
    return FileResponse(out, filename="prymo-archive.zip")


# ---------------------------------------------------------------- zip extract
@router.post("/unzip")
async def unzip(file: UploadFile = File(...)):
    data = await file.read()
    job = new_job_dir()
    src = safe_join(job, "archive.zip")
    with open(src, "wb") as fh:
        fh.write(data)
    outdir = os.path.join(job, "extracted")
    os.makedirs(outdir, exist_ok=True)
    try:
        with zipfile.ZipFile(src) as zf:
            infos = zf.infolist()
            if not infos:
                raise HTTPException(400, "ZIP archive is empty")
            extracted = []
            for info in infos:
                if info.is_dir():
                    continue
                # sanitize member path (zip-slip protection)
                name = os.path.normpath(info.filename).lstrip("/\\")
                if name.startswith(".."):
                    continue
                target = os.path.join(outdir, name)
                os.makedirs(os.path.dirname(target), exist_ok=True)
                with zf.open(info) as src_fh, open(target, "wb") as dst:
                    dst.write(src_fh.read())
                extracted.append(target)
    except zipfile.BadZipFile as exc:
        raise HTTPException(400, "Not a valid ZIP file") from exc
    out = os.path.join(job, "extracted.zip")
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
        for p in extracted:
            zf.write(p, os.path.relpath(p, outdir))
    return FileResponse(out, filename=(os.path.splitext(file.filename or "archive")[0]) + "-extracted.zip",
                        media_type="application/zip")


# ---------------------------------------------------------------- QR code
@router.post("/qr")
async def qr(text: str = Form(...), size: int = Form(8), border: int = Form(2),
             fg: str = Form("#a3e635"), bg: str = Form("#000000"),
             fmt: str = Form("png")):
    if not text.strip():
        raise HTTPException(400, "Text/URL required")
    import segno
    try:
        qr = segno.make(text, error="m")
    except Exception as exc:
        raise HTTPException(400, f"Cannot encode: {exc}") from exc
    buf = io.BytesIO()
    fmt = fmt.lower()
    if fmt == "svg":
        qr.save(buf, kind="svg", scale=max(1, size), border=max(0, border),
                dark=fg, light=bg)
        return Response(buf.getvalue(), media_type="image/svg+xml",
                        headers={"Content-Disposition": 'attachment; filename="qr.svg"'})
    qr.save(buf, kind="png", scale=max(1, size), border=max(0, border),
            dark=fg, light=bg)
    return Response(buf.getvalue(), media_type="image/png",
                    headers={"Content-Disposition": 'attachment; filename="qr.png"'})


# ---------------------------------------------------------------- Barcode (EAN/Code128...)
@router.post("/barcode")
async def barcode(text: str = Form(...), symbology: str = Form("code128"),
                  height: int = Form(80), width: int = Form(2), fmt: str = Form("png")):
    if not text.strip():
        raise HTTPException(400, "Data required")
    try:
        import barcode
        from barcode.writer import ImageWriter
    except Exception:
        raise HTTPException(503, "python-barcode not installed on server (pip install python-barcode)")
    cls = barcode.get_barcode_class(symbology)
    if cls is None:
        raise HTTPException(400, f"Unknown symbology '{symbology}'")
    try:
        bc = cls(text, writer=ImageWriter())
    except Exception as exc:
        raise HTTPException(400, f"Invalid data for {symbology}: {exc}") from exc
    buf = io.BytesIO()
    bc.write(buf, options={"module_height": height / 10.0, "module_width": width / 10.0,
                           "background": "white", "foreground": "#111111"})
    buf.seek(0)
    media = "image/png" if fmt == "png" else "image/svg+xml"
    return Response(buf.read(), media_type=media,
                    headers={"Content-Disposition": f'attachment; filename="barcode.{fmt}"'})


# ---------------------------------------------------------------- Password generator
@router.get("/password")
async def password(length: int = 16, upper: bool = True, lower: bool = True,
                   digits: bool = True, symbols: bool = True, exclude_ambiguous: bool = True):
    length = max(4, min(128, length))
    pool = ""
    required = []
    if upper:
        s = string.ascii_uppercase
        pool += s
        required.append(secrets.choice(s))
    if lower:
        s = string.ascii_lowercase
        pool += s
        required.append(secrets.choice(s))
    if digits:
        s = string.digits
        pool += s
        required.append(secrets.choice(s))
    if symbols:
        s = "!@#$%^&*()-_=+[]{};:,.<>?/~"
        pool += s
        required.append(secrets.choice(s))
    if exclude_ambiguous:
        pool = "".join(c for c in pool if c not in "Il1O0o`'\"|")
        required = [c for c in required if c in pool]
    if not pool:
        raise HTTPException(400, "Select at least one character type")
    chars = required + [secrets.choice(pool) for _ in range(length - len(required))]
    # Fisher-Yates shuffle with secrets
    for i in range(len(chars) - 1, 0, -1):
        j = secrets.randbelow(i + 1)
        chars[i], chars[j] = chars[j], chars[i]
    pwd = "".join(chars)[:length]
    # entropy estimate
    import math
    entropy = round(length * math.log2(len(pool)), 1)
    return {"password": pwd, "length": len(pwd), "entropy_bits": entropy}
