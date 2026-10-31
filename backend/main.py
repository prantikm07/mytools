"""prymo ToolBox — FastAPI backend.

Serves the compiled React frontend from ``backend/static`` and exposes all
file-processing APIs under ``/api/*``. 100% open-source stack, no paid APIs.
"""
from __future__ import annotations

import asyncio
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .api import images, media, pdfs, utils
from .storage import TMP_ROOT, janitor

STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")

app = FastAPI(title="prymo ToolBox", version="1.0.0",
              description="Open-source multi-purpose file converter, compressor & toolkit.")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

os.makedirs(TMP_ROOT, exist_ok=True)

app.include_router(images.router)
app.include_router(pdfs.router)
app.include_router(media.router)
app.include_router(utils.router)


@app.on_event("startup")
async def _startup():
    asyncio.create_task(janitor())  # TTL cleanup of temp files (delete after 1 hour)


@app.get("/api/health")
async def health():
    import shutil
    return {
        "ok": True,
        "ghostscript": shutil.which("gs") is not None,
        "ffmpeg": shutil.which("ffmpeg") is not None,
        "qpdf": shutil.which("qpdf") is not None,
    }


# ---- static frontend (built React app) -------------------------------------
if os.path.isdir(STATIC_DIR) and os.path.isfile(os.path.join(STATIC_DIR, "index.html")):

    @app.get("/{full_path:path}")
    async def spa(full_path: str):
        candidate = os.path.normpath(os.path.join(STATIC_DIR, full_path))
        if full_path and candidate.startswith(STATIC_DIR) and os.path.isfile(candidate):
            return FileResponse(candidate)
        return FileResponse(os.path.join(STATIC_DIR, "index.html"))
else:
    @app.get("/")
    async def root():
        return {"app": "prymo ToolBox API", "docs": "/docs"}
