"""PDF tools: advanced compression, merge, split, rotate, convert to/from
images, watermark, unlock/protect. Uses PyMuPDF (open source), pypdf, and
Ghostscript via CLI when available."""
from __future__ import annotations

import io
import os
import shutil
import subprocess
import zipfile

import pymupdf  # PyMuPDF
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from PIL import Image
from pypdf import PdfReader, PdfWriter

from ..storage import new_job_dir, safe_join

router = APIRouter(prefix="/api/pdf", tags=["pdf"])

GS_BIN = shutil.which("gs")

PRESETS = {
    "low":     {"dpi": 200, "quality": 80},
    "medium":  {"dpi": 150, "quality": 65},
    "high":    {"dpi": 100, "quality": 50},
    "extreme": {"dpi": 72,  "quality": 30},
}


def _open(data: bytes) -> pymupdf.Document:
    doc = pymupdf.open(stream=data, filetype="pdf")
    if doc.needs_pass:
        doc.close()
        raise HTTPException(422, "PDF is password-protected. Use Unlock PDF first.")
    return doc


# ---------------------------------------------------------------- compression
@router.post("/compress")
async def compress(file: UploadFile = File(...), dpi: int = Form(150),
                   quality: int = Form(60), grayscale: bool = Form(False),
                   flatten: bool = Form(False), preset: str = Form("")):
    if preset in PRESETS:
        dpi = PRESETS[preset]["dpi"]
        quality = PRESETS[preset]["quality"]
    data = await file.read()
    job = new_job_dir()
    src = safe_join(job, "input.pdf")
    with open(src, "wb") as fh:
        fh.write(data)
    base = os.path.splitext(os.path.basename(file.filename or "doc.pdf"))[0]
    out = safe_join(job, f"{base}-compressed.pdf")

    done = False
    if GS_BIN:
        # Ghostscript path: real downsampling + recompression of embedded images.
        color = "/Gray" if grayscale else "/sRGB"
        cmd = [
            GS_BIN, "-sDEVICE=pdfwrite", "-dCompatibilityLevel=1.5",
            "-dNOPAUSE", "-dBATCH", "-dSAFER",
            "-dColorImageDownsampleType=/Bicubic",
            "-dGrayImageDownsampleType=/Bicubic",
            "-dMonoImageDownsampleType=/SubsampleAverage",
            "-dDownsampleColorImages=true", "-dDownsampleGrayImages=true",
            "-dDownsampleMonoImages=true",
            f"-dColorImageResolution={dpi}",
            f"-dGrayImageResolution={dpi}",
            f"-dMonoImageResolution={max(dpi, 150)}",
            f"-dJPEGQ={max(1, min(100, quality))}",
            f"-dColorConversionStrategy={color}",
            "-dConvertCMYKImagesToRGB=true",
            "-dAutoFilterColorImages=false", "-dColorImageFilter=/DCTEncode",
            "-dAutoFilterGrayImages=false", "-dGrayImageFilter=/DCTEncode",
            "-dPreserveAnnots=" + ("false" if flatten else "true"),
            "-dDetectDuplicateImages=true",
            f"-sOutputFile={out}", src,
        ]
        try:
            proc = subprocess.run(cmd, capture_output=True, timeout=300)
            done = proc.returncode == 0 and os.path.exists(out) and os.path.getsize(out) > 0
            if not done:
                print("[prymo] ghostscript failed, falling back to PyMuPDF:",
                      proc.stderr.decode(errors="ignore")[-300:])
        except Exception as exc:
            print("[prymo] ghostscript error, falling back to PyMuPDF:", exc)

    if not done:
        _fitz_compress(src, out, dpi, quality, grayscale, flatten)

    if not os.path.exists(out) or os.path.getsize(out) == 0:
        shutil.copy(src, out)
    elif os.path.getsize(out) >= len(data):
        # never make the file bigger — serve the original back
        shutil.copy(src, out)
    return FileResponse(out, filename=os.path.basename(out))


def _fitz_compress(src: str, out: str, dpi: int, quality: int,
                   grayscale: bool, flatten: bool):
    """Fallback compressor using PyMuPDF: re-encodes every embedded image to
    JPEG at the requested DPI/quality and optionally converts to grayscale."""
    doc = pymupdf.open(src)
    if doc.needs_pass:
        doc.close()
        raise HTTPException(422, "PDF is password-protected. Use Unlock PDF first.")
    seen: set[int] = set()
    factor = max(dpi, 24) / 150.0  # heuristic scale relative to typical scan DPI
    for page in doc:
        if flatten:
            for annot in list(page.annots()):
                try:
                    page.delete_annot(annot)
                except Exception:
                    pass
            try:
                page.clean_contents()
            except Exception:
                pass
        for img_info in page.get_images(full=True):
            xref = img_info[0]
            if xref in seen:
                continue
            seen.add(xref)
            try:
                pix = pymupdf.Pixmap(doc, xref)
                if pix.width < 8 or pix.height < 8:
                    continue
                if pix.alpha:
                    pix = pymupdf.Pixmap(pix, 0)
                if grayscale and pix.colorspace and pix.colorspace.n != 1:
                    pix = pymupdf.Pixmap(pymupdf.csGRAY, pix)
                nw = max(8, int(pix.width * factor))
                nh = max(8, int(pix.height * factor))
                if nw < pix.width and nh < pix.height:
                    pix = _resize_pixmap(pix, nw, nh)
                q = max(1, min(100, quality))
                img_bytes = pix.tobytes("jpeg", jpg_quality=q)
                smask = doc.xref_get_key(xref, "SMask")
                if smask and smask[0] not in ("null", "none"):
                    doc.xref_set_key(xref, "SMask", "null")
                doc.update_stream(xref, img_bytes, compress=False)
                doc.xref_set_key(xref, "Filter", "/DCTDecode")
                cs = "/DeviceGray" if (grayscale and pix.colorspace and pix.colorspace.n == 1) else "/DeviceRGB"
                doc.xref_set_key(xref, "ColorSpace", cs)
                doc.xref_set_key(xref, "BitsPerComponent", "8")
                doc.xref_set_key(xref, "Width", str(pix.width))
                doc.xref_set_key(xref, "Height", str(pix.height))
            except Exception:
                continue
    doc.save(out, garbage=4, deflate=True, clean=True,
             deflate_images=True, deflate_fonts=True)
    doc.close()


def _resize_pixmap(pix, w: int, h: int):
    """Resize a pixmap via Pillow (PyMuPDF has no high-quality resampler)."""
    mode = "L" if pix.n == 1 else "RGB"
    img = Image.frombytes(mode, (pix.width, pix.height), pix.samples)
    img = img.resize((w, h), Image.LANCZOS)
    cs = pymupdf.csGRAY if mode == "L" else pymupdf.csRGB
    return pymupdf.Pixmap(cs, pymupdf.IRect(0, 0, w, h), img.tobytes())


# ---------------------------------------------------------------- merge
@router.post("/merge")
async def merge(files: list[UploadFile] = File(...)):
    writer = PdfWriter()
    for f in files:
        raw = await f.read()
        _open(raw)  # encryption check -> raises 422 when protected
        try:
            reader = PdfReader(io.BytesIO(raw))
            for p in reader.pages:
                writer.add_page(p)
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(400, f"Cannot read '{f.filename}': {exc}") from exc
    job = new_job_dir()
    out = safe_join(job, "merged.pdf")
    with open(out, "wb") as fh:
        writer.write(fh)
    return FileResponse(out, filename="merged.pdf")


# ---------------------------------------------------------------- split
@router.post("/split")
async def split(file: UploadFile = File(...), mode: str = Form("ranges"),
                ranges: str = Form("1-1"), every: int = Form(1)):
    data = await file.read()
    _open(data)
    try:
        reader = PdfReader(io.BytesIO(data))
    except Exception as exc:
        raise HTTPException(400, f"Cannot read PDF: {exc}") from exc
    n = len(reader.pages)
    job = new_job_dir()
    results: list[str] = []
    base = os.path.splitext(os.path.basename(file.filename or "doc.pdf"))[0]

    def parse_ranges(spec: str) -> list[int]:
        pages: list[int] = []
        for part in spec.split(","):
            part = part.strip()
            if not part:
                continue
            if "-" in part:
                a, b = part.split("-", 1)
                pages.extend(range(int(a), int(b) + 1))
            else:
                pages.append(int(part))
        return sorted({p for p in pages if 1 <= p <= n})

    if mode == "all-pages":
        groups = [[i] for i in range(1, n + 1)]
    elif mode == "every-n":
        step = max(1, every)
        groups = [list(range(i, min(i + step, n + 1))) for i in range(1, n + 1, step)]
    else:  # extract ranges into one pdf
        try:
            pages = parse_ranges(ranges)
        except ValueError:
            raise HTTPException(400, "Invalid page range syntax. Use e.g. '1-3,7'.")
        if not pages:
            raise HTTPException(400, "No valid page ranges")
        groups = [pages]

    for gi, group in enumerate(groups, 1):
        writer = PdfWriter()
        for pi in group:
            writer.add_page(reader.pages[pi - 1])
        suffix = f"pages-{group[0]}-{group[-1]}" if mode == "ranges" else f"part-{gi:03d}"
        p = safe_join(job, f"{base}-{suffix}.pdf")
        with open(p, "wb") as fh:
            writer.write(fh)
        results.append(p)
    return _zip_or_single(job, results)


# ---------------------------------------------------------------- rotate
@router.post("/rotate")
async def rotate(file: UploadFile = File(...), angle: int = Form(90),
                 pages_spec: str = Form("")):
    data = await file.read()
    doc = _open(data)
    targets: list[int] | range = list(range(doc.page_count))
    if pages_spec.strip():
        idx = set()
        try:
            for part in pages_spec.split(","):
                part = part.strip()
                if not part:
                    continue
                if "-" in part:
                    a, b = map(int, part.split("-", 1))
                    idx.update(range(a - 1, b))
                else:
                    idx.add(int(part) - 1)
        except ValueError:
            raise HTTPException(400, "Invalid page specification, use e.g. '1-3,5'")
        targets = sorted(i for i in idx if 0 <= i < doc.page_count)
    for i in targets:
        page = doc[i]
        page.set_rotation((page.rotation + angle) % 360)
    job = new_job_dir()
    out = safe_join(job, os.path.splitext(os.path.basename(file.filename or "doc.pdf"))[0] + "-rotated.pdf")
    doc.save(out, garbage=3, deflate=True)
    doc.close()
    return FileResponse(out, filename=os.path.basename(out))


# ---------------------------------------------------------------- pdf -> images
@router.post("/to-images")
async def to_images(file: UploadFile = File(...), fmt: str = Form("png"),
                    dpi: int = Form(150)):
    data = await file.read()
    doc = _open(data)
    job = new_job_dir()
    results = []
    zoom = max(36, dpi) / 72.0
    mat = pymupdf.Matrix(zoom, zoom)
    base = os.path.splitext(os.path.basename(file.filename or "doc.pdf"))[0]
    for i, page in enumerate(doc, 1):
        pix = page.get_pixmap(matrix=mat, alpha=False)
        p = safe_join(job, f"{base}-page-{i:03d}.{fmt}")
        if fmt in ("jpg", "jpeg"):
            img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
            img.save(p, "JPEG", quality=90)
        else:
            pix.save(p)
        results.append(p)
    doc.close()
    return _zip_or_single(job, results)


# ---------------------------------------------------------------- images -> pdf
@router.post("/from-images")
async def from_images(files: list[UploadFile] = File(...), page_size: str = Form("fit"),
                      margin: int = Form(0)):
    doc = pymupdf.open()
    A4 = (595, 842)
    for f in files:
        raw = await f.read()
        try:
            img = Image.open(io.BytesIO(raw))
            if img.mode not in ("RGB", "L"):
                img = img.convert("RGB")
            buf = io.BytesIO()
            img.save(buf, "JPEG", quality=90)
            jpeg = buf.getvalue()
        except Exception as exc:
            raise HTTPException(400, f"Cannot read image '{f.filename}': {exc}") from exc
        tmp = pymupdf.open(stream=jpeg, filetype="jpeg")
        rect = tmp[0].rect
        tmp.close()
        if page_size == "a4":
            pw, ph = A4
            ratio = min((pw - 2 * margin) / rect.width, (ph - 2 * margin) / rect.height, 1.0)
            iw, ih = rect.width * ratio, rect.height * ratio
            page = doc.new_page(width=pw, height=ph)
            page.insert_image(pymupdf.Rect((pw - iw) / 2, (ph - ih) / 2,
                                           (pw + iw) / 2, (ph + ih) / 2), stream=jpeg)
        else:  # fit each page to the image
            page = doc.new_page(width=rect.width + 2 * margin, height=rect.height + 2 * margin)
            page.insert_image(pymupdf.Rect(margin, margin, rect.width + margin,
                                           rect.height + margin), stream=jpeg)
    job = new_job_dir()
    out = safe_join(job, "images-to-pdf.pdf")
    doc.save(out, garbage=3, deflate=True)
    doc.close()
    return FileResponse(out, filename="images-to-pdf.pdf")


# ---------------------------------------------------------------- watermark
@router.post("/watermark")
async def watermark(file: UploadFile = File(...), text: str = Form(""),
                    image: UploadFile | None = None, opacity: float = Form(0.15),
                    size: int = Form(48), position: str = Form("center"),
                    color: str = Form("#a3e635"), rotate_deg: int = Form(45)):
    data = await file.read()
    doc = _open(data)
    img_bytes = None
    if image is not None and image.filename:
        img_bytes = await image.read()
    if not img_bytes and not text:
        raise HTTPException(400, "Provide watermark text or an image")
    opacity = max(0.02, min(1.0, opacity))

    def xy(r, w, h):
        m = 20
        pts = {
            "top-left": (m, m),
            "top-right": (r.width - w - m, m),
            "bottom-left": (m, r.height - h - m),
            "bottom-right": (r.width - w - m, r.height - h - m),
            "center": ((r.width - w) / 2, (r.height - h) / 2),
        }
        return pts.get(position, pts["center"])

    for page in doc:
        r = page.rect
        if img_bytes:
            iw = r.width / 3
            ih = iw * 0.8
            x0, y0 = xy(r, iw, ih)
            page.insert_image(pymupdf.Rect(x0, y0, x0 + iw, y0 + ih),
                              stream=img_bytes, overlay=True, opacity=opacity)
        else:
            tw = pymupdf.get_text_length(text, fontname="helv", fontsize=size)
            box_w, box_h = tw + 12, size + 12
            col = _rgb(color)
            matrix = pymupdf.Matrix(rotate_deg)
            if position == "tile":
                step_x = int(tw + 80)
                step_y = int(size * 4)
                for ty in range(-step_y, int(r.height) + step_y, step_y):
                    for tx in range(-step_x, int(r.width) + step_x, step_x):
                        center = pymupdf.Point(tx + box_w / 2, ty + box_h / 2)
                        page.insert_text(center, text, fontsize=size, fontname="helv",
                                         color=col, morph=(center, matrix),
                                         overlay=True, fill_opacity=opacity)
            else:
                x0, y0 = xy(r, box_w, box_h)
                center = pymupdf.Point(x0 + box_w / 2, y0 + box_h / 2)
                page.insert_text(center, text, fontsize=size, fontname="helv",
                                 color=col, morph=(center, matrix),
                                 overlay=True, fill_opacity=opacity)
    job = new_job_dir()
    out = safe_join(job, os.path.splitext(os.path.basename(file.filename or "doc.pdf"))[0] + "-watermarked.pdf")
    doc.save(out, garbage=3, deflate=True)
    doc.close()
    return FileResponse(out, filename=os.path.basename(out))


def _rgb(hex_color: str):
    try:
        h = hex_color.lstrip("#")
        return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    except Exception:
        return (0.64, 0.9, 0.2)


# ---------------------------------------------------------------- protect / unlock
@router.post("/protect")
async def protect(file: UploadFile = File(...), password: str = Form(...)):
    if not password:
        raise HTTPException(400, "Password required")
    data = await file.read()
    _open(data)  # raises 422 if already encrypted
    job = new_job_dir()
    src = safe_join(job, "in.pdf")
    out = safe_join(job, os.path.splitext(os.path.basename(file.filename or "doc.pdf"))[0] + "-protected.pdf")
    with open(src, "wb") as fh:
        fh.write(data)
    qpdf = shutil.which("qpdf")
    if qpdf:
        proc = subprocess.run([qpdf, "--encrypt", password, password, "--bits=256",
                               src, out], capture_output=True, timeout=120)
        if proc.returncode == 0 and os.path.exists(out):
            return FileResponse(out, filename=os.path.basename(out))
    writer = PdfWriter()
    reader = PdfReader(src)
    for p in reader.pages:
        writer.add_page(p)
    writer.encrypt(password)
    with open(out, "wb") as fh:
        writer.write(fh)
    return FileResponse(out, filename=os.path.basename(out))


@router.post("/unlock")
async def unlock(file: UploadFile = File(...), password: str = Form("")):
    data = await file.read()
    job = new_job_dir()
    src = safe_join(job, "in.pdf")
    out = safe_join(job, os.path.splitext(os.path.basename(file.filename or "doc.pdf"))[0] + "-unlocked.pdf")
    with open(src, "wb") as fh:
        fh.write(data)
    qpdf = shutil.which("qpdf")
    if qpdf:
        cmd = [qpdf, "--decrypt"]
        if password:
            cmd.append(f"--password={password}")
        cmd += [src, out]
        proc = subprocess.run(cmd, capture_output=True, timeout=120)
        if proc.returncode == 0 and os.path.exists(out):
            return FileResponse(out, filename=os.path.basename(out))
        raise HTTPException(422, "Could not decrypt: " + proc.stderr.decode(errors="ignore")[-200:])
    # fallback: pypdf
    reader = PdfReader(src)
    if reader.is_encrypted:
        if not reader.decrypt(password or ""):
            raise HTTPException(422, "Wrong password. Install qpdf on the server for full AES-256 support.")
    writer = PdfWriter()
    for p in reader.pages:
        writer.add_page(p)
    with open(out, "wb") as fh:
        writer.write(fh)
    return FileResponse(out, filename=os.path.basename(out))


def _zip_or_single(job: str, paths: list[str]):
    if len(paths) == 1:
        p = paths[0]
        return FileResponse(p, filename=os.path.basename(p))
    zpath = os.path.join(job, "prymo-batch.zip")
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as zf:
        for p in paths:
            zf.write(p, os.path.basename(p))
    return FileResponse(zpath, filename="prymo-batch.zip", media_type="application/zip")
