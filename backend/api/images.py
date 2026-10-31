"""Image tools: advanced compression, convert, resize, crop, rotate/flip,
merge, GIF make/extract, dominant colors. Powered by Pillow (open source)."""
from __future__ import annotations

import io
import os
import zipfile

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from PIL import Image, ImageOps

from ..storage import new_job_dir, safe_join

router = APIRouter(prefix="/api/images", tags=["images"])

FORMATS = {"jpg": "JPEG", "jpeg": "JPEG", "png": "PNG", "webp": "WEBP"}
MAX_PIXELS = 80_000_000
Image.MAX_IMAGE_PIXELS = MAX_PIXELS


def _load(data: bytes) -> Image.Image:
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
        return img
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, f"Cannot read image: {exc}") from exc


def _save(img: Image.Image, fmt: str, quality: int, strip: bool, dpi: int | None) -> bytes:
    buf = io.BytesIO()
    save_fmt = FORMATS[fmt.lower()]
    if save_fmt == "JPEG":
        if img.mode in ("RGBA", "LA", "P"):
            bg = Image.new("RGB", img.size, (255, 255, 255))
            if img.mode == "P":
                img = img.convert("RGBA")
            bg.paste(img, mask=img.split()[-1] if "A" in img.getbands() else None)
            img = bg
        elif img.mode != "RGB":
            img = img.convert("RGB")
        info = {}
        if dpi:
            info["dpi"] = (dpi, dpi)
        img.save(buf, format="JPEG", quality=max(1, min(100, quality)), optimize=True, **info)
    elif save_fmt == "PNG":
        params = {"optimize": True}
        if strip:
            params["pnginfo"] = None
        img.save(buf, format="PNG", **params)
    else:  # WEBP
        info = {}
        if dpi:
            info["dpi"] = (dpi, dpi)
        img.save(buf, format="WEBP", quality=max(1, min(100, quality)), method=6, **info)
    return buf.getvalue()


def _compress_one(img: Image.Image, *, quality: int, max_w: int | None, max_h: int | None,
                  target_kb: int | None, dpi: int | None, fmt: str, strip: bool) -> bytes:
    if img.mode == "P":
        img = img.convert("RGBA")

    def render(source: Image.Image, q: int) -> bytes:
        cur = source
        if max_w or max_h:
            w, h = cur.size
            mw = max_w or w
            mh = max_h or h
            if w > mw or h > mh:
                ratio = min(mw / w, mh / h)
                cur = cur.resize((max(1, round(w * ratio)), max(1, round(h * ratio))), Image.LANCZOS)
        return _save(cur, fmt, q, strip, dpi)

    out = render(img, quality)

    # Target file size: binary-search quality (and downscale if needed) to fit.
    if target_kb and target_kb > 0:
        target_bytes = target_kb * 1024
        if len(out) > target_bytes:
            lo, hi, best = 1, quality - 1, out
            while lo <= hi:
                mid = (lo + hi) // 2
                cand = render(img, mid)
                if len(cand) <= target_bytes:
                    best, lo = cand, mid + 1   # try higher quality
                else:
                    hi = mid - 1               # need lower quality
            out = best
            # still too big at low quality -> progressively downscale + re-search
            attempts = 0
            while len(out) > target_bytes and attempts < 8:
                w, h = img.size
                if w < 32 and h < 32:
                    break
                img = img.resize((max(16, int(w * 0.85)), max(16, int(h * 0.85))), Image.LANCZOS)
                lo, hi, best = 1, 30, render(img, 1)
                while lo <= hi:
                    mid = (lo + hi) // 2
                    cand = render(img, mid)
                    if len(cand) <= target_bytes:
                        best, lo = cand, mid + 1
                    else:
                        hi = mid - 1
                out = best
                attempts += 1
    return out


@router.post("/compress")
async def compress(files: list[UploadFile] = File(...),
                   quality: int = Form(80),
                   max_width: int = Form(0),
                   max_height: int = Form(0),
                   target_kb: int = Form(0),
                   dpi: int = Form(0),
                   fmt: str = Form(""),
                   strip: bool = Form(True)):
    """Advanced granular image compressor (batch-capable)."""
    job = new_job_dir()
    results = []
    for f in files:
        img = _load(await f.read())
        src_ext = os.path.splitext(f.filename or "img.jpg")[1].lstrip(".").lower() or "jpg"
        out_fmt = fmt if fmt in FORMATS else ("png" if src_ext == "png" else "webp" if src_ext == "webp" else "jpg")
        data = _compress_one(img, quality=quality, max_w=max_width or None,
                             max_h=max_height or None, target_kb=target_kb or None,
                             dpi=dpi or None, fmt=out_fmt, strip=strip)
        base = os.path.splitext(os.path.basename(f.filename or "image"))[0]
        name = f"{base}-compressed.{out_fmt}"
        p = safe_join(job, name)
        with open(p, "wb") as fh:
            fh.write(data)
        results.append(p)
    return _zip_or_single(job, results)


@router.post("/convert")
async def convert(files: list[UploadFile] = File(...), fmt: str = Form("jpg"),
                  quality: int = Form(90)):
    if fmt not in FORMATS:
        raise HTTPException(400, "Unsupported format")
    job = new_job_dir()
    results = []
    for f in files:
        img = _load(await f.read())
        data = _save(img, fmt, quality, True, None)
        base = os.path.splitext(os.path.basename(f.filename or "image"))[0]
        p = safe_join(job, f"{base}.{fmt}")
        with open(p, "wb") as fh:
            fh.write(data)
        results.append(p)
    return _zip_or_single(job, results)


@router.post("/resize")
async def resize(files: list[UploadFile] = File(...), width: int = Form(0), height: int = Form(0),
                 percent: int = Form(0), keep_aspect: bool = Form(True), fmt: str = Form("")):
    job = new_job_dir()
    results = []
    for f in files:
        img = _load(await f.read())
        w, h = img.size
        if percent:
            w, h = max(1, round(w * percent / 100)), max(1, round(h * percent / 100))
        elif width or height:
            if keep_aspect:
                if width and not height:
                    h = max(1, round(h * width / w)); w = width
                elif height and not width:
                    w = max(1, round(w * height / h)); h = height
                else:
                    ratio = min(width / w, height / h)
                    w, h = max(1, round(w * ratio)), max(1, round(h * ratio))
            else:
                w = width or w
                h = height or h
        img = img.resize((w, h), Image.LANCZOS)
        src_ext = os.path.splitext(f.filename or "img.png")[1].lstrip(".").lower() or "png"
        out_fmt = fmt if fmt in FORMATS else (src_ext if src_ext in FORMATS else "png")
        data = _save(img, out_fmt, 90, True, None)
        base = os.path.splitext(os.path.basename(f.filename or "image"))[0]
        p = safe_join(job, f"{base}-{w}x{h}.{out_fmt}")
        with open(p, "wb") as fh:
            fh.write(data)
        results.append(p)
    return _zip_or_single(job, results)


@router.post("/crop")
async def crop(files: list[UploadFile] = File(...), x: int = Form(0), y: int = Form(0),
               w: int = Form(0), h: int = Form(0), aspect: str = Form("")):
    job = new_job_dir()
    results = []
    for f in files:
        img = _load(await f.read()).convert("RGBA") if False else _load(await f.read())
        iw, ih = img.size
        cw = w or iw
        ch = h or ih
        cx = x
        cy = y
        if aspect and ":" in aspect:
            try:
                aw, ah = map(float, aspect.split(":"))
            except ValueError:
                raise HTTPException(400, "Bad aspect ratio")
            target = aw / ah
            if cw / ch > target:
                cw = int(ch * target)
            else:
                ch = int(cw / target)
            cx = (iw - cw) // 2
            cy = (ih - ch) // 2
        cx, cy = max(0, cx), max(0, cy)
        box = (cx, cy, min(iw, cx + cw), min(ih, cy + ch))
        if box[2] <= box[0] or box[3] <= box[1]:
            raise HTTPException(400, "Crop region outside image bounds")
        out = img.crop(box)
        ext = os.path.splitext(f.filename or "img.png")[1] or ".png"
        data = _save(out, ext.lstrip(".").lower() if ext.lstrip(".").lower() in FORMATS else "png", 90, True, None)
        base = os.path.splitext(os.path.basename(f.filename or "image"))[0]
        p = safe_join(job, f"{base}-cropped.png" if ext.lstrip(".") not in FORMATS else f"{base}-cropped{ext}")
        with open(p, "wb") as fh:
            fh.write(data)
        results.append(p)
    return _zip_or_single(job, results)


@router.post("/transform")
async def transform(files: list[UploadFile] = File(...), angle: int = Form(0),
                    flip_h: bool = Form(False), flip_v: bool = Form(False)):
    job = new_job_dir()
    results = []
    for f in files:
        img = _load(await f.read())
        if angle:
            img = img.rotate(-angle, expand=True)
        if flip_h:
            img = ImageOps.mirror(img)
        if flip_v:
            img = ImageOps.flip(img)
        ext = os.path.splitext(f.filename or "img.png")[1] or ".png"
        fmt = ext.lstrip(".").lower()
        data = _save(img, fmt if fmt in FORMATS else "png", 90, True, None)
        base = os.path.splitext(os.path.basename(f.filename or "image"))[0]
        p = safe_join(job, f"{base}-transformed.{fmt if fmt in FORMATS else 'png'}")
        with open(p, "wb") as fh:
            fh.write(data)
        results.append(p)
    return _zip_or_single(job, results)


@router.post("/merge")
async def merge(files: list[UploadFile] = File(...), mode: str = Form("vertical"),
                gap: int = Form(10), columns: int = Form(2), bg: str = Form("#ffffff")):
    imgs = [_load(await f.read()).convert("RGB") for f in files]
    if len(imgs) < 2:
        raise HTTPException(400, "Need at least two images to merge")
    try:
        bgcolor = tuple(int(bg.lstrip("#")[i:i + 2], 16) for i in (0, 2, 4))
    except Exception:
        bgcolor = (255, 255, 255)
    if mode == "horizontal":
        h = max(i.height for i in imgs)
        scaled = [i.resize((round(i.width * h / i.height), h), Image.LANCZOS) for i in imgs]
        total_w = sum(i.width for i in scaled) + gap * (len(scaled) - 1)
        canvas = Image.new("RGB", (total_w, h), bgcolor)
        x = 0
        for i in scaled:
            canvas.paste(i, (x, 0)); x += i.width + gap
    elif mode == "grid":
        cols = max(1, columns)
        rows = (len(imgs) + cols - 1) // cols
        cell_w = max(i.width for i in imgs)
        cell_h = max(i.height for i in imgs)
        canvas = Image.new("RGB", (cols * cell_w + (cols - 1) * gap, rows * cell_h + (rows - 1) * gap), bgcolor)
        for idx, i in enumerate(imgs):
            r, c = divmod(idx, cols)
            px = c * (cell_w + gap) + (cell_w - i.width) // 2
            py = r * (cell_h + gap) + (cell_h - i.height) // 2
            canvas.paste(i, (px, py))
    else:  # vertical
        w = max(i.width for i in imgs)
        scaled = [i.resize((w, round(i.height * w / i.width)), Image.LANCZOS) for i in imgs]
        total_h = sum(i.height for i in scaled) + gap * (len(scaled) - 1)
        canvas = Image.new("RGB", (w, total_h), bgcolor)
        y = 0
        for i in scaled:
            canvas.paste(i, (0, y)); y += i.height + gap
    job = new_job_dir()
    p = safe_join(job, "merged.png")
    canvas.save(p, "PNG", optimize=True)
    return _zip_or_single(job, [p])


@router.post("/to-gif")
async def to_gif(files: list[UploadFile] = File(...), delay: int = Form(100),
                 loop: int = Form(0), scale_width: int = Form(0)):
    imgs = [_load(await f.read()).convert("RGBA") for f in files]
    if not imgs:
        raise HTTPException(400, "No images supplied")
    if scale_width:
        imgs = [i.resize((scale_width, round(i.height * scale_width / i.width)), Image.LANCZOS) for i in imgs]
    w = max(i.width for i in imgs)
    h = max(i.height for i in imgs)
    frames = []
    for i in imgs:
        c = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        c.paste(i, ((w - i.width) // 2, (h - i.height) // 2))
        frames.append(c.convert("P", palette=Image.ADAPTIVE))
    job = new_job_dir()
    p = safe_join(job, "animation.gif")
    frames[0].save(p, save_all=True, append_images=frames[1:], duration=max(20, delay),
                   loop=loop, disposal=2, optimize=True)
    return _zip_or_single(job, [p])


@router.post("/gif-extract")
async def gif_extract(file: UploadFile = File(...), fmt: str = Form("png")):
    data = await file.read()
    try:
        gif = Image.open(io.BytesIO(data))
        gif.seek(0)
    except Exception as exc:
        raise HTTPException(400, f"Not a valid GIF: {exc}") from exc
    job = new_job_dir()
    results = []
    idx = 0
    try:
        while True:
            frame = gif.convert("RGBA")
            buf = io.BytesIO()
            save_fmt = FORMATS.get(fmt.lower(), "PNG")
            frame.save(buf, format=save_fmt)
            p = safe_join(job, f"frame-{idx:03d}.{fmt}")
            buf.seek(0)
            with open(p, "wb") as fh:
                fh.write(buf.read())
            results.append(p)
            idx += 1
            gif.seek(gif.tell() + 1)
    except EOFError:
        pass
    if not results:
        raise HTTPException(400, "GIF contains no frames")
    return _zip_or_single(job, results)


@router.post("/colors")
async def colors(files: list[UploadFile] = File(...), count: int = Form(6)):
    """Dominant color palette extraction (Hex/RGB)."""
    out = []
    for f in files:
        img = _load(await f.read()).convert("RGB")
        small = img.resize((100, max(1, round(100 * img.height / img.width))))
        pal = small.quantize(colors=max(2, min(16, count)), method=Image.MEDIANCUT)
        palette = pal.getpalette()[: 3 * count]
        cols = []
        for i in range(0, len(palette), 3):
            r, g, b = palette[i:i + 3]
            cols.append({"hex": f"#{r:02X}{g:02X}{b:02X}", "rgb": [r, g, b]})
        out.append({"file": f.filename, "colors": cols})
    return {"palettes": out}


def _zip_or_single(job: str, paths: list[str]):
    if len(paths) == 1:
        p = paths[0]
        return FileResponse(p, filename=os.path.basename(p))
    zpath = os.path.join(job, "prymo-batch.zip")
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as zf:
        for p in paths:
            zf.write(p, os.path.basename(p))
    return FileResponse(zpath, filename="prymo-batch.zip", media_type="application/zip")
