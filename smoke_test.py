"""Smoke tests for prymo ToolBox API endpoints."""
import io
import sys

sys.path.insert(0, "/workspace")
from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image  # noqa: E402

from backend.main import app  # noqa: E402

client = TestClient(app)


def make_image(w=800, h=600, fmt="PNG"):
    buf = io.BytesIO()
    img = Image.new("RGB", (w, h))
    for x in range(0, w, 7):
        for y in range(0, h, 5):
            img.putpixel((x, y), ((x * 3) % 256, (y * 5) % 256, (x + y) % 256))
    img.save(buf, fmt)
    buf.seek(0)
    return buf.read()


def check(name, resp, expect=(200,)):
    ok = resp.status_code in expect
    print(f"{'PASS' if ok else 'FAIL'} {name} -> {resp.status_code}")
    if not ok:
        print(resp.text[:300])
    return ok, resp


results = []

# health
r = client.get("/api/health")
results.append(check("health", r))

# image compress with target size (binary search must hit <=200KB)
data = make_image(1600, 1200)
r = client.post("/api/images/compress",
                files={"files": ("photo.png", data, "image/png")},
                data={"quality": 90, "target_kb": 50, "fmt": "jpg", "dpi": 72, "strip": "true"})
ok, resp = check("image compress target-size", r)
if ok:
    out = resp.content
    results.append(("under target", len(out) <= 50 * 1024, len(out)))
    print(f"  output bytes={len(out)} (target 50KB) -> {'OK' if len(out)<=51200 else 'TOO BIG'}")

# batch zip
r = client.post("/api/images/compress",
                files=[("files", ("a.png", data, "image/png")), ("files", ("b.png", data, "image/png"))],
                data={"quality": 70})
check("image batch zip", r)

# convert / resize / transform / crop
r = client.post("/api/images/convert", files={"files": ("a.png", data, "image/png")}, data={"fmt": "webp"})
check("image convert webp", r)
r = client.post("/api/images/resize", files={"files": ("a.png", data, "image/png")},
                data={"width": 400, "keep_aspect": "true"})
check("image resize", r)
r = client.post("/api/images/transform", files={"files": ("a.png", data, "image/png")},
                data={"angle": 90, "flip_h": "true"})
check("image rotate/flip", r)
r = client.post("/api/images/crop", files={"files": ("a.png", data, "image/png")},
                data={"x": "10", "y": "10", "w": "100", "h": "100"})
check("image crop", r)
r = client.post("/api/images/crop", files={"files": ("a.png", data, "image/png")},
                data={"aspect": "1:1"})
check("image crop aspect", r)

# merge
r = client.post("/api/images/merge",
                files=[("files", ("a.png", data, "image/png")), ("files", ("b.png", data, "image/png"))],
                data={"mode": "grid", "columns": "2"})
check("image merge grid", r)

# gif make + extract
frames = []
for i in range(3):
    b = io.BytesIO()
    Image.new("RGB", (100, 100), (i * 80, 40, 200 - i * 60)).save(b, "PNG")
    frames.append(("files", (f"f{i}.png", b.getvalue(), "image/png")))
r = client.post("/api/images/to-gif", files=frames, data={"delay": "200"})
ok, resp = check("images to gif", r)
gif_bytes = resp.content if ok else b""
if gif_bytes:
    r = client.post("/api/images/gif-extract", files={"file": ("anim.gif", gif_bytes, "image/gif")},
                    data={"fmt": "png"})
    check("gif extract frames", r)

# colors
r = client.post("/api/images/colors", files={"files": ("a.png", data, "image/png")}, data={"count": "5"})
ok, resp = check("color extraction", r)
if ok:
    print("  palette:", resp.json()["palettes"][0]["colors"][:3])

# PDFs: build a multi-page pdf with images via from-images
imgs = [("files", (f"p{i}.png", make_image(500, 700), "image/png")) for i in range(3)]
r = client.post("/api/pdf/from-images", files=imgs, data={"page_size": "a4"})
ok, resp = check("images -> pdf", r)
pdf_bytes = resp.content if ok else b""

if pdf_bytes:
    r = client.post("/api/pdf/merge", files=[("files", ("a.pdf", pdf_bytes, "application/pdf")),
                                             ("files", ("b.pdf", pdf_bytes, "application/pdf"))])
    ok2, resp2 = check("pdf merge", r)
    merged = resp2.content if ok2 else b""
    if merged:
        r = client.post("/api/pdf/split", files={"file": ("m.pdf", merged, "application/pdf")},
                        data={"mode": "ranges", "ranges": "1-2,5"})
        check("pdf split ranges", r)
        r = client.post("/api/pdf/split", files={"file": ("m.pdf", merged, "application/pdf")},
                        data={"mode": "all-pages"})
        check("pdf split all pages (zip)", r)
        r = client.post("/api/pdf/rotate", files={"file": ("m.pdf", merged, "application/pdf")},
                        data={"angle": "180", "pages_spec": "1-3"})
        check("pdf rotate", r)
        r = client.post("/api/pdf/to-images", files={"file": ("m.pdf", merged, "application/pdf")},
                        data={"fmt": "jpg", "dpi": "100"})
        check("pdf -> images", r)
        r = client.post("/api/pdf/compress", files={"file": ("m.pdf", merged, "application/pdf")},
                        data={"preset": "extreme", "grayscale": "true", "flatten": "true"})
        ok3, resp3 = check("pdf compress extreme+gray", r)
        if ok3:
            print(f"  in={len(merged)}B out={len(resp3.content)}B")
        r = client.post("/api/pdf/watermark", files={"file": ("m.pdf", merged, "application/pdf")},
                        data={"text": "CONFIDENTIAL", "opacity": "0.2", "position": "tile", "size": "30"})
        check("pdf watermark tile", r)
        r = client.post("/api/pdf/protect", files={"file": ("m.pdf", merged, "application/pdf")},
                        data={"password": "s3cret"})
        ok4, resp4 = check("pdf protect", r)
        if ok4:
            enc = resp4.content
            r = client.post("/api/pdf/unlock", files={"file": ("enc.pdf", enc, "application/pdf")},
                            data={"password": "s3cret"})
            check("pdf unlock", r)

# media
r = client.get("/api/media/transcribe-status")
check("transcribe status", r)

# utils
r = client.post("/api/utils/zip", files=[("files", ("a.txt", b"hello", "text/plain")),
                                         ("files", ("b.bin", data, "image/png"))])
ok, resp = check("zip maker", r)
if ok:
    r = client.post("/api/utils/unzip", files={"file": ("arc.zip", resp.content, "application/zip")})
    check("zip extractor", r)
r = client.post("/api/utils/qr", data={"text": "https://example.com", "fg": "#a3e635"})
check("qr generator", r)
r = client.post("/api/utils/barcode", data={"text": "PRYMO-1234", "symbology": "code128"})
check("barcode generator", r)
r = client.get("/api/utils/password", params={"length": 20, "symbols": True})
ok, resp = check("password generator", r)
if ok:
    print("  sample:", resp.json())

fails = [name for name, res in results if isinstance(res, tuple) and len(res) == 3 and not res[1]]
errors = [name for name, ok in [(x[0], x[1][0] if isinstance(x[1], tuple) else x[1]) for x in results] if not ok]
print("\nSUMMARY:", len(results), "checks;", "ALL PASS" if not errors and not fails else f"ISSUES: {errors}{fails}")
