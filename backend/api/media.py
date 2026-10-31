"""Video & audio tools powered by FFmpeg (open source, invoked via subprocess)
and local transcription with faster-whisper (optional, open source)."""
from __future__ import annotations

import os
import shutil
import subprocess

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse

from ..storage import TMP_ROOT, new_job_dir, safe_join

router = APIRouter(prefix="/api/media", tags=["media"])

FFMPEG = shutil.which("ffmpeg")
WHISPER_MODEL = os.environ.get("PRYMO_WHISPER_MODEL", "base")

AUDIO_EXTS = {"mp3", "wav", "aac", "ogg", "flac", "m4a"}
VIDEO_EXT_HINTS = {".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v", ".flv", ".wmv"}


def _require_ffmpeg():
    if not FFMPEG:
        raise HTTPException(503, "FFmpeg is not installed on the server. See README for install instructions.")


@router.post("/extract-audio")
async def extract_audio(files: list[UploadFile] = File(...), fmt: str = Form("mp3"),
                        bitrate: str = Form("192"), sample_rate: int = Form(0)):
    _require_ffmpeg()
    if fmt not in AUDIO_EXTS:
        raise HTTPException(400, "Unsupported audio format")
    job = new_job_dir()
    results = []
    codec = {"mp3": "libmp3lame", "wav": "pcm_s16le", "aac": "aac",
             "ogg": "libvorbis", "flac": "flac", "m4a": "aac"}[fmt]
    for f in files:
        src = safe_join(job, "in-" + os.path.basename(f.filename or "video.mp4"))
        with open(src, "wb") as fh:
            fh.write(await f.read())
        base = os.path.splitext(os.path.basename(src))[0].replace("in-", "", 1)
        out = safe_join(job, f"{base}.{fmt}")
        cmd = [FFMPEG, "-y", "-i", src, "-vn", "-acodec", codec]
        if fmt in ("mp3", "aac", "m4a", "ogg"):
            cmd += ["-b:a", f"{bitrate}k"]
        if sample_rate:
            cmd += ["-ar", str(sample_rate)]
        cmd.append(out)
        proc = subprocess.run(cmd, capture_output=True, timeout=1800)
        if proc.returncode != 0 or not os.path.exists(out):
            raise HTTPException(400, "FFmpeg failed: " + proc.stderr.decode(errors="ignore")[-300:])
        os.remove(src)
        results.append(out)
    if len(results) == 1:
        return FileResponse(results[0], filename=os.path.basename(results[0]))
    import zipfile
    zpath = os.path.join(job, "prymo-audio.zip")
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as zf:
        for p in results:
            zf.write(p, os.path.basename(p))
    return FileResponse(zpath, filename="prymo-audio.zip", media_type="application/zip")


@router.get("/transcribe-status")
async def transcribe_status():
    available = False
    try:
        import faster_whisper  # noqa: F401
        available = True
    except Exception:
        available = False
    return {"available": available, "model": WHISPER_MODEL,
            "hint": "" if available else "pip install faster-whisper (see README)"}


@router.post("/transcribe")
async def transcribe(file: UploadFile = File(...), language: str = Form(""),
                    model_size: str = Form(WHISPER_MODEL)):
    _require_ffmpeg()
    try:
        from faster_whisper import WhisperModel
    except Exception:
        return JSONResponse(status_code=503, content={
            "error": "Transcription engine not installed. Run `pip install faster-whisper` "
                     "on the server (fully open source, no paid APIs). See README."})
    job = new_job_dir()
    src = safe_join(job, "in-" + os.path.basename(file.filename or "media.mp4"))
    with open(src, "wb") as fh:
        fh.write(await file.read())
    wav = safe_join(job, "audio.wav")
    proc = subprocess.run([FFMPEG, "-y", "-i", src, "-ac", "1", "-ar", "16000", wav],
                          capture_output=True, timeout=1800)
    if proc.returncode != 0:
        raise HTTPException(400, "Could not extract audio: " + proc.stderr.decode(errors="ignore")[-300:])
    try:
        model = WhisperModel(model_size or "base", device="cpu", compute_type="int8")
        segments, info = model.transcribe(wav, language=language or None, vad_filter=True)

        def fmt_ts(t: float) -> str:
            ms = int((t - int(t)) * 1000)
            mm, ss = divmod(int(t), 60)
            hh, mm = divmod(mm, 60)
            return f"{hh:02d}:{mm:02d}:{ss:02d},{ms:03d}"

        lines = []
        for seg in segments:
            lines.append({"start": seg.start, "end": seg.end, "text": seg.text.strip()})
        plain = "\n".join(l["text"] for l in lines)
        txt_path = safe_join(job, "transcript.txt")
        srt_path = safe_join(job, "transcript.srt")
        with open(txt_path, "w", encoding="utf-8") as fh:
            fh.write(plain + "\n")
        with open(srt_path, "w", encoding="utf-8") as fh:
            for i, l in enumerate(lines, 1):
                fh.write(f"{i}\n{fmt_ts(l['start'])} --> {fmt_ts(l['end'])}\n{l['text']}\n\n")
        rel = os.path.relpath(job, TMP_ROOT)
        return {"language": getattr(info, "language", None),
                "text": plain, "lines": lines,
                "files": {"txt": f"/api/media/file/{rel}/transcript.txt",
                          "srt": f"/api/media/file/{rel}/transcript.srt"}}
    except Exception as exc:
        raise HTTPException(500, f"Transcription failed: {exc}") from exc


@router.get("/file/{path:path}")
async def serve_result_file(path: str):
    """Serve a transcript file produced by /transcribe (restricted to the tmp root)."""
    full = os.path.normpath(os.path.join(TMP_ROOT, path))
    if not full.startswith(TMP_ROOT) or not os.path.isfile(full):
        raise HTTPException(404, "File expired or not found")
    return FileResponse(full, filename=os.path.basename(full))
