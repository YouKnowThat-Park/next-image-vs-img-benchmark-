'use client';

import { useState, useRef, useCallback, useLayoutEffect, useEffect } from 'react';
import NextImage from 'next/image';

const IMAGES = [
  { label: '200×200 · Low · PNG',  src: '/wooseok-200x200-low.png',  width: 200,  height: 200,  bytes: 5244  },
  { label: '200×200 · Low · WebP', src: '/wooseok-200x200-low.webp', width: 200,  height: 200,  bytes: 1742  },
  { label: '200×200 · Mid · PNG',  src: '/wooseok-200x200-mid.png',  width: 200,  height: 200,  bytes: 5244  },
  { label: '200×200 · Mid · WebP', src: '/wooseok-200x200-mid.webp', width: 200,  height: 200,  bytes: 2676  },
  { label: '300×300 · PNG',        src: '/wooseok-300x300.png',       width: 300,  height: 300,  bytes: 7809  },
  { label: '500×500 · PNG',        src: '/wooseok-500x500.png',       width: 500,  height: 500,  bytes: 13090 },
  { label: '500×500 · WebP',       src: '/wooseok-500x500.webp',      width: 500,  height: 500,  bytes: 5292  },
  { label: '800×800 · PNG',        src: '/wooseok-800x800.png',       width: 800,  height: 800,  bytes: 22178 },
  { label: '800×800 · WebP',       src: '/wooseok-800x800.webp',      width: 800,  height: 800,  bytes: 10190 },
  { label: '1200×1200 · PNG',      src: '/wooseok-1200x1200.png',     width: 1200, height: 1200, bytes: 34875 },
  { label: '1200×1200 · WebP',     src: '/wooseok-1200x1200.webp',    width: 1200, height: 1200, bytes: 18098 },
];

function fmtBytes(b: number) {
  if (b >= 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${b} B`;
}

interface RoundResult {
  round: number;
  imgMs: number;
  nextMs: number;
}

// ─── Hidden img loader ────────────────────────────────────────────────────────
function ImgLoader({
  src,
  onLoaded,
}: {
  src: string;
  onLoaded: (ms: number) => void;
}) {
  const startRef = useRef<number>(0);
  const imgRef   = useRef<HTMLImageElement>(null);
  const reported = useRef(false);

  const report = useCallback((ms: number) => {
    if (reported.current) return;
    reported.current = true;
    onLoaded(Math.max(0, ms));
  }, [onLoaded]);

  useLayoutEffect(() => {
    startRef.current = performance.now();
  }, []);

  useEffect(() => {
    if (imgRef.current?.complete) report(performance.now() - startRef.current);
  }, [report]);

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={imgRef}
      src={src}
      alt=""
      style={{ position: 'fixed', top: -9999, left: -9999, opacity: 0 }}
      onLoad={() => report(performance.now() - startRef.current)}
    />
  );
}

// ─── Hidden next/image loader ─────────────────────────────────────────────────
const NEXT_ALLOWED_WIDTHS = [16,32,48,64,96,128,256,384,640,750,828,1080,1200,1920,2048,3840];

function NextLoader({
  src,
  width,
  onLoaded,
}: {
  src: string;
  width: number;
  onLoaded: (ms: number) => void;
}) {
  const startRef = useRef<number>(0);
  const imgRef   = useRef<HTMLImageElement>(null);
  const reported = useRef(false);

  const report = useCallback((ms: number) => {
    if (reported.current) return;
    reported.current = true;
    onLoaded(Math.max(0, ms));
  }, [onLoaded]);

  useLayoutEffect(() => {
    startRef.current = performance.now();
  }, []);

  useEffect(() => {
    if (imgRef.current?.complete) report(performance.now() - startRef.current);
  }, [report]);

  const w = NEXT_ALLOWED_WIDTHS.find(s => s >= width) ?? 3840;
  const optimizedSrc = `/_next/image?url=${encodeURIComponent(src)}&w=${w}&q=75`;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={imgRef}
      src={optimizedSrc}
      alt=""
      style={{ position: 'fixed', top: -9999, left: -9999, opacity: 0 }}
      onLoad={() => report(performance.now() - startRef.current)}
    />
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function BenchmarkTool() {
  const [imgIdx, setImgIdx]        = useState(0);
  const [rounds, setRounds]        = useState(3);
  const [results, setResults]      = useState<RoundResult[]>([]);
  const [phase, setPhase]          = useState<'idle' | 'running' | 'done'>('idle');
  const [currentRound, setCurrent] = useState(0);
  const [roundKey, setRoundKey]    = useState(0);

  const pending  = useRef<{ img?: number; next?: number }>({});
  const roundRef = useRef(0);
  const totalRef = useRef(rounds);
  const accRef   = useRef<RoundResult[]>([]);

  const selected = IMAGES[imgIdx];

  const nextRound = useCallback((n: number) => {
    pending.current = {};
    roundRef.current = n;
    setCurrent(n);
    setRoundKey(k => k + 1);
  }, []);

  const tryFinish = useCallback(() => {
    const { img, next } = pending.current;
    if (img == null || next == null) return;

    const round = roundRef.current;
    const result: RoundResult = { round, imgMs: img, nextMs: next };
    accRef.current = [...accRef.current, result];
    setResults([...accRef.current]);

    if (round < totalRef.current) {
      setTimeout(() => nextRound(round + 1), 300);
    } else {
      setPhase('done');
    }
  }, [nextRound]);

  const handleImgLoad  = useCallback((ms: number) => { pending.current.img  = ms; tryFinish(); }, [tryFinish]);
  const handleNextLoad = useCallback((ms: number) => { pending.current.next = ms; tryFinish(); }, [tryFinish]);

  const start = () => {
    totalRef.current = rounds;
    accRef.current   = [];
    setResults([]);
    nextRound(1);
    setPhase('running');
  };

  const reset = () => {
    setPhase('idle');
    setResults([]);
    setCurrent(0);
    accRef.current = [];
  };

  useEffect(() => {
    if (phase === 'done') {
      const perfEntries = performance.getEntriesByType('resource');
      console.log('Network timing:', perfEntries);
    }
  }, [phase]);

  const avgImg  = results.length ? results.reduce((s, r) => s + r.imgMs,  0) / results.length : 0;
  const avgNext = results.length ? results.reduce((s, r) => s + r.nextMs, 0) / results.length : 0;
  const avgDiff = Math.abs(avgImg - avgNext);
  const winner  = avgImg <= avgNext ? 'img' : 'next';

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6 md:p-10">
      <div className="max-w-2xl mx-auto space-y-6">

        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Image Load Benchmark</h1>
          <p className="text-gray-400 mt-1 text-sm">
            next/image vs &lt;img&gt; — Round 1 always cold · Round 2+ browser cache
          </p>
        </div>

        {/* Config */}
        <div className="bg-gray-900 rounded-2xl p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">Image</label>
              <select
                value={imgIdx}
                onChange={e => setImgIdx(+e.target.value)}
                disabled={phase === 'running'}
                className="w-full bg-gray-800 text-white rounded-lg px-3 py-2 text-sm disabled:opacity-50"
              >
                {IMAGES.map((img, i) => (
                  <option key={i} value={i}>{img.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">Rounds</label>
              <select
                value={rounds}
                onChange={e => setRounds(+e.target.value)}
                disabled={phase === 'running'}
                className="w-full bg-gray-800 text-white rounded-lg px-3 py-2 text-sm disabled:opacity-50"
              >
                {[1, 3, 5, 10].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </div>

          <div className="flex gap-3 items-center">
            <button
              onClick={start}
              disabled={phase === 'running'}
              className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 px-5 py-2 rounded-lg text-sm font-semibold transition-colors cursor-pointer disabled:cursor-not-allowed"
            >
              {phase === 'running'
                ? `Running ${currentRound} / ${rounds}…`
                : phase === 'done' ? 'Run Again' : 'Run Benchmark'}
            </button>
            {phase !== 'idle' && (
              <button
                onClick={reset}
                disabled={phase === 'running'}
                className="bg-gray-700 hover:bg-gray-600 disabled:opacity-40 px-5 py-2 rounded-lg text-sm font-semibold transition-colors cursor-pointer"
              >
                Reset
              </button>
            )}
          </div>

          <p className="text-xs text-gray-600">
            For accurate results: open in incognito mode and clear cache before each run (Ctrl+Shift+Delete).
          </p>
        </div>

        {/* Hidden timing loaders */}
        {phase === 'running' && (
          <div aria-hidden style={{ position: 'fixed', top: -9999, left: -9999 }}>
            <ImgLoader
              key={`img-${roundKey}`}
              src={selected.src}
              onLoaded={handleImgLoad}
            />
            <NextLoader
              key={`next-${roundKey}`}
              src={selected.src}
              width={selected.width}
              onLoaded={handleNextLoad}
            />
          </div>
        )}

        {/* Image preview — shown only after done, uses plain src (display only) */}
        {phase === 'done' && (
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-gray-900 rounded-2xl p-4 flex flex-col gap-3">
              <span className="text-xs text-gray-500 font-mono uppercase tracking-wider text-center">&lt;img&gt;</span>
              <div className="w-full bg-gray-800 rounded-xl flex items-center justify-center" style={{ height: 200 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={selected.src}
                  alt={selected.label}
                  style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                />
              </div>
              <div className="text-center space-y-0.5">
                <p className="text-xs text-gray-400">{selected.width} × {selected.height} px</p>
                <p className="text-xs font-mono text-gray-300">{fmtBytes(selected.bytes)}</p>
                <p className="text-xs text-gray-600">원본 파일</p>
              </div>
            </div>

            <div className="bg-gray-900 rounded-2xl p-4 flex flex-col gap-3">
              <span className="text-xs text-gray-500 font-mono uppercase tracking-wider text-center">next/image</span>
              <div className="w-full bg-gray-800 rounded-xl relative" style={{ height: 200 }}>
                <NextImage
                  src={selected.src}
                  alt={selected.label}
                  fill
                  style={{ objectFit: 'contain' }}
                />
              </div>
              <div className="text-center space-y-0.5">
                <p className="text-xs text-gray-400">{selected.width} × {selected.height} px</p>
                <p className="text-xs font-mono text-gray-300">{fmtBytes(selected.bytes)}</p>
                <p className="text-xs text-gray-600">Next.js 최적화</p>
              </div>
            </div>
          </div>
        )}

        {/* Results */}
        {results.length > 0 && (
          <div className="bg-gray-900 rounded-2xl p-6 space-y-5">
            <h2 className="font-semibold">{selected.label}</h2>

            {phase === 'done' && (
              <div className="grid grid-cols-2 gap-3">
                {(
                  [
                    { key: 'img' as const,  label: '<img>',     avg: avgImg  },
                    { key: 'next' as const, label: 'next/image', avg: avgNext },
                  ]
                ).map(({ key, label, avg }) => {
                  const isWinner = key === winner;
                  return (
                    <div key={key} className={`rounded-xl p-4 ${isWinner ? 'bg-green-950 border border-green-700' : 'bg-gray-800'}`}>
                      <div className="text-xs text-gray-400 font-mono mb-1">{label}</div>
                      <div className="text-2xl font-bold font-mono">
                        {avg.toFixed(1)}
                        <span className="text-sm font-normal text-gray-400 ml-1">ms avg</span>
                      </div>
                      {isWinner && (
                        <div className="text-green-400 text-xs mt-1">▲ Faster by {avgDiff.toFixed(1)} ms</div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 uppercase border-b border-gray-800">
                  <th className="text-left pb-2 font-medium">Round</th>
                  <th className="text-right pb-2 font-mono font-medium">&lt;img&gt;</th>
                  <th className="text-right pb-2 font-mono font-medium">next/image</th>
                  <th className="text-right pb-2 font-medium">Faster</th>
                </tr>
              </thead>
              <tbody>
                {results.map(r => {
                  const rWinner = r.imgMs <= r.nextMs ? 'img' : 'next';
                  const rDiff   = Math.abs(r.imgMs - r.nextMs);
                  const isCold  = r.round === 1;
                  return (
                    <tr key={r.round} className="border-b border-gray-800/50">
                      <td className="py-2 text-gray-400">
                        #{r.round}
                        <span className={`ml-2 text-xs px-1.5 py-0.5 rounded ${isCold ? 'bg-blue-900/50 text-blue-400' : 'bg-yellow-900/50 text-yellow-400'}`}>
                          {isCold ? 'cold' : 'cache'}
                        </span>
                      </td>
                      <td className={`py-2 text-right font-mono ${rWinner === 'img' ? 'text-green-400' : 'text-gray-300'}`}>
                        {r.imgMs.toFixed(1)} ms
                      </td>
                      <td className={`py-2 text-right font-mono ${rWinner === 'next' ? 'text-green-400' : 'text-gray-300'}`}>
                        {r.nextMs.toFixed(1)} ms
                      </td>
                      <td className="py-2 text-right text-xs text-gray-400">
                        {rWinner === 'img' ? '<img>' : 'next/image'}
                        <span className="text-gray-600 ml-1">−{rDiff.toFixed(1)}ms</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
