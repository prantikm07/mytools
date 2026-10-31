import React, { useEffect, useMemo, useState } from 'react';
import { Icon } from './components/ui';
import { getJSON } from './api';
import { ColorExtractor, GifTools, ImageCompressor, ImageMerge, SimpleImageTool } from './tools/imageTools';
import { PdfCompressor, PdfTool, PdfWatermark } from './tools/pdfTools';
import { CodeGenerator, PasswordGen, Transcript, VideoToAudio, ZipTool } from './tools/miscTools';

/* ------------------------------------------------------------------ catalog */
export const CATEGORIES = [
  {
    name: '⭐ Featured · Granular Compression',
    tools: [
      { id: 'img-compress', name: 'Advanced Image Compressor', icon: 'compress', featured: true,
        desc: 'Quality slider, max dimensions, target file size (binary-search), DPI, format conversion, EXIF strip.',
        comp: ImageCompressor },
      { id: 'pdf-compress', name: 'Advanced PDF Compressor', icon: 'pdf', featured: true,
        desc: 'Image downsampling DPI, JPEG quality, grayscale, flatten, Low/Medium/High/Extreme presets via Ghostscript.',
        comp: PdfCompressor },
    ],
  },
  {
    name: '🖼️ Image Tools',
    tools: [
      { id: 'convert', name: 'Convert Image', icon: 'convert', desc: 'JPG · PNG · WEBP, in batch.', comp: SimpleImageTool },
      { id: 'resize', name: 'Resize Image', icon: 'resize', desc: 'Pixels or percentage with aspect-ratio lock.', comp: SimpleImageTool },
      { id: 'crop', name: 'Crop Image', icon: 'crop', desc: 'Free crop or 16:9 / 4:3 / 1:1 / 9:16 presets.', comp: SimpleImageTool },
      { id: 'transform', name: 'Rotate / Flip', icon: 'rotate', desc: '90°, 180°, 270° + horizontal/vertical mirror.', comp: SimpleImageTool },
      { id: 'merge-img', name: 'Image Merge', icon: 'merge', desc: 'Combine images vertically, horizontally or as a grid.', comp: ImageMerge },
      { id: 'img2gif', name: 'Images → GIF', icon: 'gif', desc: 'Build animated GIFs with frame-delay control.', comp: GifTools },
      { id: 'gif2img', name: 'GIF → Images', icon: 'split', desc: 'Extract every frame as PNG/JPG.', comp: GifTools },
    ],
  },
  {
    name: '📄 PDF Tools',
    tools: [
      { id: 'merge', name: 'Merge PDF', icon: 'merge', desc: 'Combine PDFs with drag-drop reordering.', comp: PdfTool },
      { id: 'split', name: 'Split PDF', icon: 'split', desc: 'Extract ranges or split into separate files.', comp: PdfTool },
      { id: 'rotate-pdf', name: 'Rotate PDF', icon: 'rotate', desc: 'Whole document or specific pages.', comp: PdfTool },
      { id: 'pdf2img', name: 'PDF → Image', icon: 'image', desc: 'Every page to JPG/PNG at chosen DPI.', comp: PdfTool },
      { id: 'img2pdf', name: 'Image → PDF', icon: 'pdf', desc: 'Bundle images into one PDF.', comp: PdfTool },
      { id: 'watermark', name: 'Add Watermark', icon: 'watermark', desc: 'Text/image watermark — opacity, size, position, tile.', comp: PdfWatermark },
      { id: 'protect', name: 'Protect PDF', icon: 'lock', desc: 'Add AES password protection.', comp: PdfTool },
      { id: 'unlock', name: 'Unlock PDF', icon: 'unlock', desc: 'Remove password protection (qpdf).', comp: PdfTool },
    ],
  },
  {
    name: '🎬 Video & Audio',
    tools: [
      { id: 'extract-audio', name: 'Video → Audio', icon: 'audio', desc: 'MP3 · WAV · AAC · OGG · FLAC via FFmpeg.', comp: VideoToAudio },
      { id: 'transcribe', name: 'Video Transcript', icon: 'transcript', desc: 'Local faster-whisper speech-to-text. No paid APIs.', comp: Transcript },
    ],
  },
  {
    name: '🧰 Utilities',
    tools: [
      { id: 'zip', name: 'ZIP Maker', icon: 'zip', desc: 'Bundle any files into a ZIP archive.', comp: ZipTool },
      { id: 'unzip', name: 'ZIP Extractor', icon: 'zip', desc: 'Unpack ZIP contents safely.', comp: ZipTool },
      { id: 'qr', name: 'QR / Barcode Generator', icon: 'qr', desc: 'QR codes + Code128/EAN/UPC barcodes.', comp: CodeGenerator },
      { id: 'password', name: 'Password Generator', icon: 'key', desc: 'Length, character classes, entropy meter.', comp: PasswordGen },
      { id: 'colors', name: 'Color Extractor', icon: 'palette', desc: 'Dominant palette (Hex/RGB) from any image.', comp: ColorExtractor },
    ],
  },
];

const ALL_TOOLS = CATEGORIES.flatMap((c) => c.tools);
const byId = Object.fromEntries(ALL_TOOLS.map((t) => [t.id, t]));

/* ---------------------------------------------------------------- landing */
function Landing({ open }) {
  const [q, setQ] = useState('');
  const cats = useMemo(() => CATEGORIES.map((c) => ({
    ...c, tools: c.tools.filter((t) => !q || t.name.toLowerCase().includes(q.toLowerCase()) || t.desc.toLowerCase().includes(q.toLowerCase())),
  })).filter((c) => c.tools.length), [q]);

  return (
    <div className="fade-in">
      {/* hero */}
      <section className="text-center py-14 px-4">
        <div className="inline-flex items-center gap-2 chip chip-on mb-6 cursor-default">
          <span className="w-2 h-2 rounded-full bg-lime-accent animate-pulse" /> 100% free · open source · self-hosted
        </div>
        <h1 className="text-4xl sm:text-6xl font-black text-white tracking-tight">
          Every file tool.<br />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-lime-accent to-emerald-400">One toolbox.</span>
        </h1>
        <p className="mt-5 text-zinc-400 max-w-2xl mx-auto text-lg">
          Convert, compress, merge and edit images, PDFs, video & audio — with granular, professional-grade control.
          Batch processing included. Your files are auto-deleted after 1 hour.
        </p>
        <div className="mt-8 max-w-xl mx-auto relative">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search 20+ tools… (compress, pdf, gif, qr)"
            className="input !py-3.5 !pl-11 !rounded-2xl" />
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-lime-accent">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4-4" /></svg>
          </span>
        </div>
      </section>

      {/* categories */}
      <div className="max-w-6xl mx-auto px-4 pb-20 space-y-12">
        {cats.map((cat) => (
          <section key={cat.name}>
            <h2 className="text-xl font-extrabold text-white mb-4">{cat.name}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {cat.tools.map((t) => (
                <button key={t.id} onClick={() => open(t.id)}
                  className={`tool-card text-left ${t.featured ? 'ring-1 ring-lime-accent/40 sm:col-span-2' : ''}`}>
                  <div className="flex items-center justify-between">
                    <div className="w-11 h-11 rounded-xl bg-lime-accent/10 border border-lime-accent/30 grid place-items-center text-lime-accent group-hover:bg-lime-accent group-hover:text-ink-950 transition-colors">
                      <Icon name={t.icon} size={22} />
                    </div>
                    {t.featured && <span className="chip chip-on !cursor-default">Hero ⭐</span>}
                  </div>
                  <div>
                    <h3 className="font-bold text-white">{t.name}</h3>
                    <p className="text-xs text-zinc-500 mt-1 leading-relaxed">{t.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </section>
        ))}
        {!cats.length && <p className="text-center text-zinc-500 py-16">No tools match “{q}”.</p>}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- app shell */
export default function App() {
  const [route, setRoute] = useState(() => location.hash.replace('#/', '') || '');
  const [health, setHealth] = useState(null);

  useEffect(() => {
    const onHash = () => { setRoute(location.hash.replace('#/', '')); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', onHash);
    getJSON('/api/health').then(setHealth).catch(() => {});
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const open = (id) => { location.hash = `#/${id}`; };
  const goHome = () => { location.hash = ''; };
  const tool = byId[route];

  return (
    <div className="min-h-screen flex flex-col">
      {/* nav */}
      <header className="sticky top-0 z-50 backdrop-blur-md bg-ink-950/80 border-b border-white/5">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <button onClick={goHome} className="flex items-center gap-3 group">
            <div className="w-9 h-9 rounded-xl bg-lime-accent grid place-items-center text-ink-950 font-black text-lg shadow-[0_0_18px_rgba(163,230,53,0.4)] group-hover:scale-105 transition-transform">P</div>
            <span className="font-black text-xl text-white">prymo <span className="text-lime-accent">ToolBox</span></span>
          </button>
          <nav className="flex items-center gap-3">
            {health && (
              <span title={`Ghostscript:${health.ghostscript} FFmpeg:${health.ffmpeg} qpdf:${health.qpdf}`}
                className="hidden sm:flex items-center gap-1.5 text-xs text-zinc-500">
                <span className={`w-2 h-2 rounded-full ${health.ok ? 'bg-lime-accent' : 'bg-red-500'} animate-pulse`} />
                engines online
              </span>
            )}
            <a href="/docs" target="_blank" rel="noreferrer" className="btn-ghost">API Docs</a>
            <button onClick={goHome} className="btn-ghost"><Icon name="home" size={16} /> All tools</button>
          </nav>
        </div>
      </header>

      <main className="flex-1 px-4 py-8">
        {tool ? <tool.comp tool={tool} /> : <Landing open={open} />}
      </main>

      <footer className="border-t border-white/5 py-8 text-center text-sm text-zinc-500">
        <p><span className="text-lime-accent font-bold">prymo ToolBox</span> — built only with open-source software (FastAPI · Pillow · PyMuPDF · Ghostscript · pypdf · FFmpeg · faster-whisper · segno · React · Tailwind).</p>
        <p className="mt-1">Temporary files are automatically purged 1 hour after upload. No tracking. No paid APIs.</p>
      </footer>
    </div>
  );
}
