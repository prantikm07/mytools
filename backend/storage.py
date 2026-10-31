"""Temporary file storage with TTL cleanup for prymo ToolBox.

Files uploaded to the backend are stored under ``backend/tmp/<job_id>/`` and are
automatically deleted after 1 hour (checked on a background task every 5 min).
"""
from __future__ import annotations

import asyncio
import os
import shutil
import time
import uuid

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TMP_ROOT = os.path.join(BASE_DIR, "tmp")
TTL_SECONDS = 60 * 60  # 1 hour


def new_job_dir() -> str:
    """Create and return a unique job directory."""
    job_id = uuid.uuid4().hex[:12]
    path = os.path.join(TMP_ROOT, job_id)
    os.makedirs(path, exist_ok=True)
    return path


def safe_join(job_dir: str, name: str) -> str:
    """Join a filename inside a job dir, preventing path traversal."""
    name = os.path.basename(name)
    return os.path.join(job_dir, name)


def cleanup_expired() -> int:
    """Delete job directories older than TTL_SECONDS. Returns count removed."""
    removed = 0
    if not os.path.isdir(TMP_ROOT):
        return removed
    now = time.time()
    for entry in os.listdir(TMP_ROOT):
        p = os.path.join(TMP_ROOT, entry)
        if os.path.isdir(p):
            try:
                if now - os.path.getmtime(p) > TTL_SECONDS:
                    shutil.rmtree(p, ignore_errors=True)
                    removed += 1
            except OSError:
                pass
    return removed


async def janitor():
    """Background loop that periodically purges expired files."""
    while True:
        try:
            await asyncio.to_thread(cleanup_expired)
        except Exception:
            pass
        await asyncio.sleep(300)  # every 5 minutes
