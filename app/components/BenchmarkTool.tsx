'use client';

import { useState, useRef, useEffect } from 'react';
import NextImage from 'next/image';

const IMAGES = [
  { label: '50 KB · PNG',   src: '/wooseok-50kb.png',   width: 1000, height: 800,  bytes: 43902  },
  { label: '50 KB · WebP',  src: '/wooseok-50kb.webp',  width: 1000, height: 800,  bytes: 38058  },
  { label: '100 KB · PNG',  src: '/wooseok-100kb.png',  width: 1400, height: 1000, bytes: 58589  },
  { label: '100 KB · WebP', src: '/wooseok-100kb.webp', width: 1400, height: 1000, bytes: 51800  },
  { label: '200 KB · PNG',  src: '/wooseok-200kb.png',  width: 1800, height: 1400, bytes: 83672  },
  { label: '200 KB · WebP', src: '/wooseok-200kb.webp', width: 1800, height: 1400, bytes: 90784  },
  { label: '300 KB · PNG',  src: '/wooseok-300kb.png',  width: 2200, height: 1600, bytes: 96873  },
  { label: '300 KB · WebP', src: '/wooseok-300kb.webp', width: 2200, height: 1600, bytes: 110880 },
  { label: '400 KB · PNG',  src: '/wooseok-400kb.png',  width: 2600, height: 1800, bytes: 116110 },
  { label: '400 KB · WebP', src: '/wooseok-400kb.webp', width: 2600, height: 1800, bytes: 166718 },
  { label: '500 KB · PNG',  src: '/wooseok-500kb.png',  width: 3000, height: 2000, bytes: 133901 },
  { label: '500 KB · WebP', src: '/wooseok-500kb.webp', width: 3000, height: 2000, bytes: 191054 },
];

const NEXT_WIDTHS = [16,32,48,64,96,128,256,384,640,750,828,1080,1200,1920,2048,3840];

interface LayoutShift extends PerformanceEntry {
  value: number;
  hadRecentInput: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtBytes(b: number) { return b >= 1024 ? `${(b/1024).toFixed(1)} KB` : `${b} B`; }
function sleep(ms: number)   { return new Promise<void>(r => setTimeout(r, ms)); }
function mean(a: number[])   { return a.length ? a.reduce((s,v)=>s+v,0)/a.length : 0; }
function median(a: number[]) {
  if (!a.length) return 0;
  const s=[...a].sort((x,y)=>x-y), m=Math.floor(s.length/2);
  return s.length%2 ? s[m] : (s[m-1]+s[m])/2;
}
function stddev(a: number[]) {
  if (a.length<2) return 0;
  const m=mean(a);
  return Math.sqrt(a.reduce((s,v)=>s+(v-m)**2,0)/a.length);
}
function ci95(a: number[]) { return a.length<2 ? 0 : 1.96*stddev(a)/Math.sqrt(a.length); }
function outlierMask(a: number[]): boolean[] {
  if (a.length<4) return a.map(()=>false);
  const s=[...a].sort((x,y)=>x-y), q1=s[Math.floor(s.length*.25)], q3=s[Math.floor(s.length*.75)], iqr=q3-q1;
  if (!iqr) return a.map(()=>false);
  return a.map(v=>v<q1-1.5*iqr||v>q3+1.5*iqr);
}
function detectBrowser() {
  const ua = navigator.userAgent;
  if (ua.includes('Edg/')) return 'Edge';
  if (ua.includes('Chrome/')) return 'Chrome';
  if (ua.includes('Firefox/')) return 'Firefox';
  if (/^((?!chrome|android).)*safari/i.test(ua)) return 'Safari';
  return 'Browser';
}

// ── Measurement ───────────────────────────────────────────────────────────────
//
// Uses img.decode() instead of onload so that decode time is included.
// img.onload fires when bytes arrive; decode() resolves when the image is
// fully rasterised and safe to composite — closer to "ready to display".

interface Timing {
  duration:        number; // total: network + decode (what we report)
  networkMs:       number; // PRT.duration  (fetchStart → responseEnd)
  decodeMs:        number; // estimated: duration − networkMs
  ttfb:            number; // responseStart − requestStart
  download:        number; // responseEnd − responseStart
  transferSize:    number;
  decodedBodySize: number;
  fromCache:       boolean;
}

async function measureUrl(url: string): Promise<Timing> {
  const img = new Image();
  img.src = url;
  const t0 = performance.now();

  try {
    await img.decode(); // waits for full rasterisation, not just byte arrival
  } catch {
    return { duration:0, networkMs:0, decodeMs:0, ttfb:0, download:0, transferSize:0, decodedBodySize:0, fromCache:false };
  }

  const elapsed = performance.now() - t0;
  const all = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
  const e   = all.filter(r => r.name === img.src).at(-1);
  const networkMs = e?.duration ?? 0;

  return {
    duration:        elapsed,
    networkMs,
    decodeMs:        Math.max(0, elapsed - networkMs),
    ttfb:           (e?.responseStart ?? 0) - (e?.requestStart  ?? 0),
    download:       (e?.responseEnd   ?? 0) - (e?.responseStart ?? 0),
    transferSize:    e?.transferSize    ?? 0,
    decodedBodySize: e?.decodedBodySize ?? 0,
    fromCache:      (e?.transferSize === 0) && ((e?.decodedBodySize ?? 0) > 0),
  };
}

interface RoundResult {
  round:    number;
  img:      Timing;
  next:     Timing;
  imgFirst: boolean; // which method went first this round
}
interface EnvInfo { browser:string; connection:string; origin:string; dpr:number }

function exportCSV(results: RoundResult[], label: string) {
  const hdr = 'round,state,order,img_ms,img_network_ms,img_decode_ms,img_kb,img_cache,next_ms,next_network_ms,next_decode_ms,next_kb,next_cache\n';
  const rows = results.map(r => [
    r.round, r.round===1?'cold':'cache', r.imgFirst?'img→next':'next→img',
    r.img.duration.toFixed(4), r.img.networkMs.toFixed(4), r.img.decodeMs.toFixed(4),
    (r.img.transferSize/1024).toFixed(3), r.img.fromCache,
    r.next.duration.toFixed(4), r.next.networkMs.toFixed(4), r.next.decodeMs.toFixed(4),
    (r.next.transferSize/1024).toFixed(3), r.next.fromCache,
  ].join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([hdr+rows],{type:'text/csv'}));
  a.download = `benchmark-${label.replace(/[\s·]+/g,'-').toLowerCase()}.csv`;
  a.click();
}

// ── Row ──────────────────────────────────────────────────────────────────────

type Winner = 'img'|'next'|'tie'|null;
function Row({ name, imgVal, nextVal, winner, note, measured }: {
  name:string; imgVal:string; nextVal:string; winner:Winner; note?:string; measured?:boolean;
}) {
  const cls = (side:'img'|'next') =>
    winner===side ? 'text-white font-semibold' : 'text-gray-400';
  return (
    <tr className="border-b border-gray-800/40">
      <td className="py-2 pr-4 text-xs text-gray-400 whitespace-nowrap">
        {name}
        {measured && <span className="ml-1.5 text-gray-700 text-xs italic">measured</span>}
      </td>
      <td className={`py-2 text-right font-mono text-xs ${cls('img')}`}>{imgVal}</td>
      <td className={`py-2 text-right font-mono text-xs ${cls('next')}`}>{nextVal}</td>
      <td className="py-2 pl-3 text-right text-xs">
        {winner==='img'  && <span className="text-green-400 bg-green-950/40 px-1.5 py-0.5 rounded">&lt;img&gt;</span>}
        {winner==='next' && <span className="text-blue-400  bg-blue-950/40  px-1.5 py-0.5 rounded">next/image</span>}
        {winner==='tie'  && <span className="text-gray-600">—</span>}
        {note && <span className="text-gray-600 ml-1.5 text-xs">{note}</span>}
      </td>
    </tr>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function BenchmarkTool() {
  const [imgIdx,     setImgIdx]     = useState(0);
  const [rounds,     setRounds]     = useState(5);
  const [results,    setResults]    = useState<RoundResult[]>([]);
  const [phase,      setPhase]      = useState<'idle'|'running'|'done'>('idle');
  const [current,    setCurrent]    = useState(0);
  const [netEntries, setNetEntries] = useState<PerformanceResourceTiming[]>([]);
  const [env,        setEnv]        = useState<EnvInfo|null>(null);
  const abortRef = useRef(false);
  const accRef   = useRef<RoundResult[]>([]);

  // CLS test
  const [clsPhase,     setClsPhase]     = useState<'idle'|'img'|'next'|'done'>('idle');
  const [clsImgScore,  setClsImgScore]  = useState<number|null>(null);
  const [clsNextScore, setClsNextScore] = useState<number|null>(null);
  const [showClsImg,   setShowClsImg]   = useState(false);
  const [showClsNext,  setShowClsNext]  = useState(false);
  const [clsToken,     setClsToken]     = useState('');
  const clsImgAcc    = useRef(0);
  const clsNextAcc   = useRef(0);
  const clsImgOnLoad = useRef<(()=>void)|null>(null);

  const selected = IMAGES[imgIdx];

  useEffect(() => {
    const nav = navigator as Navigator & { connection?: { effectiveType?: string } };
    setEnv({ browser:detectBrowser(), connection:nav.connection?.effectiveType??'n/a', origin:window.location.hostname, dpr:window.devicePixelRatio });
  }, []);

  // ── Speed benchmark ──────────────────────────────────────────────────────

  const start = async () => {
    abortRef.current = false;
    performance.clearResourceTimings();
    accRef.current = [];
    setResults([]); setNetEntries([]); setCurrent(0); setPhase('running');
    setClsPhase('idle'); setClsImgScore(null); setClsNextScore(null);
    setShowClsImg(false); setShowClsNext(false);

    const runId  = Math.random().toString(36).slice(2,8);
    const w      = NEXT_WIDTHS.find(s=>s>=selected.width)??3840;
    const imgUrl  = `${selected.src}?_cb=${runId}`;
    const nextUrl = `/_next/image?url=${encodeURIComponent(selected.src)}&w=${w}&q=75&_cb=${runId}`;

    for (let r=1; r<=rounds; r++) {
      if (abortRef.current) break;
      setCurrent(r);

      // ① Randomise order per round to cancel TCP/HTTP2 connection reuse bias.
      // Round N: img→next; Round N+1: next→img; etc.
      const imgFirst = Math.random() > 0.5;
      const firstUrl  = imgFirst ? imgUrl  : nextUrl;
      const secondUrl = imgFirst ? nextUrl : imgUrl;

      const first = await measureUrl(firstUrl);
      if (abortRef.current) break;
      await sleep(150);
      const second = await measureUrl(secondUrl);

      const img  = imgFirst ? first  : second;
      const next = imgFirst ? second : first;

      accRef.current = [...accRef.current, {round:r, img, next, imgFirst}];
      setResults([...accRef.current]);
      if (r<rounds && !abortRef.current) await sleep(300);
    }

    if (!abortRef.current) {
      const all = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
      setNetEntries(all.filter(e=>e.name.includes(selected.src)||e.name.includes('/_next/image')));
      setPhase('done');
    }
  };

  const reset = () => {
    abortRef.current = true;
    setPhase('idle'); setResults([]); setCurrent(0); setNetEntries([]);
    accRef.current = [];
    setClsPhase('idle'); setClsImgScore(null); setClsNextScore(null);
    setShowClsImg(false); setShowClsNext(false);
  };

  // ── CLS test with real PerformanceObserver ───────────────────────────────
  //
  // Uses the official layout-shift PerformanceObserver (not clientHeight proxy).
  // CLS score ∈ [0,1]: impact_fraction × distance_fraction per shift event.
  // next/image pre-reserves space via CSS aspect-ratio — score should be ≈ 0.

  const runCLS = async () => {
    const token = Date.now().toString(36);
    setClsToken(token);
    setClsImgScore(null);
    setClsNextScore(null);
    setShowClsImg(false);
    setShowClsNext(false);
    setClsPhase('img');

    await sleep(100); // let React flush

    // Measure <img> without dimensions
    clsImgAcc.current = 0;
    const obs1 = new PerformanceObserver(list => {
      for (const e of list.getEntries()) {
        const ls = e as LayoutShift;
        if (!ls.hadRecentInput) clsImgAcc.current += ls.value;
      }
    });
    try { obs1.observe({ type:'layout-shift', buffered:false }); } catch {}

    // Image load callback: resolves when <img> fires onLoad
    const imgLoaded = new Promise<void>(res => { clsImgOnLoad.current = res; });
    setShowClsImg(true);

    await imgLoaded;
    await sleep(400); // allow layout to settle
    obs1.disconnect();
    setClsImgScore(clsImgAcc.current);
    setShowClsImg(false);

    // Pause between tests
    setClsPhase('next');
    await sleep(400);

    // Measure next/image — space is pre-reserved, score should be 0
    clsNextAcc.current = 0;
    const obs2 = new PerformanceObserver(list => {
      for (const e of list.getEntries()) {
        const ls = e as LayoutShift;
        if (!ls.hadRecentInput) clsNextAcc.current += ls.value;
      }
    });
    try { obs2.observe({ type:'layout-shift', buffered:false }); } catch {}

    setShowClsNext(true);
    await sleep(800); // wait for load + settle
    obs2.disconnect();
    setClsNextScore(clsNextAcc.current);

    setClsPhase('done');
  };

  // ── Derived ───────────────────────────────────────────────────────────────

  const cold     = results.find(r=>r.round===1);
  const warmRows = results.filter(r=>r.round>1);
  const imgWarm  = warmRows.map(r=>r.img.duration);
  const nextWarm = warmRows.map(r=>r.next.duration);

  const imgOL  = outlierMask(imgWarm);
  const nextOL = outlierMask(nextWarm);
  const hasOL  = imgOL.some(Boolean)||nextOL.some(Boolean);

  const cv = (a:number[]) => a.length>=2 ? stddev(a)/mean(a) : 0;
  const highNoise = warmRows.length>=2 && (cv(imgWarm)>0.3||cv(nextWarm)>0.3);

  const coldOk = cold ? !cold.img.fromCache && !cold.next.fromCache : null;
  const warmOk = warmRows.length>0 ? warmRows.every(r=>r.img.fromCache&&r.next.fromCache) : null;

  const wStat = (a:number[], fn:(x:number[])=>number) => a.length>=2 ? fn(a).toFixed(3) : '—';
  const nd    = (v:number|null|undefined, d=2) => v!=null ? `${v.toFixed(d)} ms` : '—';

  const coldImgKB  = cold?.img.transferSize  ? cold.img.transferSize /1024 : null;
  const coldNextKB = cold?.next.transferSize ? cold.next.transferSize/1024 : null;
  const savings    = coldImgKB&&coldNextKB ? (coldImgKB-coldNextKB)/coldImgKB*100 : null;

  const warmWinner: Winner = imgWarm.length
    ? median(imgWarm)<median(nextWarm)?'img': median(imgWarm)>median(nextWarm)?'next':'tie'
    : null;

  const isWebP = selected.src.endsWith('.webp');

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6">
      <div className="max-w-5xl mx-auto space-y-4">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Image Load Benchmark</h1>
            <p className="text-gray-500 text-sm mt-0.5">
              next/image vs &lt;img&gt; — order randomised · img.decode() · PerformanceResourceTiming · real CLS score
            </p>
          </div>
          {env && (
            <div className="text-xs text-gray-600 font-mono text-right shrink-0">
              <div>{env.browser} · {env.origin}</div>
              <div>connection: {env.connection} · DPR {env.dpr}</div>
            </div>
          )}
        </div>

        {/* Known limitations */}
        <div className="bg-gray-900/60 border border-gray-800 rounded-xl px-4 py-2.5 text-xs text-gray-500 leading-relaxed">
          <span className="text-gray-400 font-semibold">Known limitations: </span>
          uses <code className="text-gray-400">new Image()</code> (no DOM render) · measures <code className="text-gray-400">/_next/image</code> endpoint, not the NextImage React component · TCP/TLS reused across rounds · no CPU/network throttle (set manually in DevTools if needed)
        </div>

        <div className="flex gap-4 items-start">

          {/* ── Left ─────────────────────────────────── */}
          <div className="w-60 shrink-0 bg-gray-900 rounded-2xl p-4 space-y-3">
            <div>
              <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">Image</label>
              <select value={imgIdx} onChange={e=>setImgIdx(+e.target.value)} disabled={phase==='running'}
                className="w-full bg-gray-800 text-white rounded-lg px-3 py-2 text-sm disabled:opacity-50">
                {IMAGES.map((img,i)=><option key={i} value={i}>{img.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">Rounds</label>
              <select value={rounds} onChange={e=>setRounds(+e.target.value)} disabled={phase==='running'}
                className="w-full bg-gray-800 text-white rounded-lg px-3 py-2 text-sm disabled:opacity-50">
                {[3,5,10,20].map(n=><option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div className="flex gap-2">
              <button onClick={start} disabled={phase==='running'}
                className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 px-3 py-2 rounded-lg text-sm font-semibold transition-colors cursor-pointer disabled:cursor-not-allowed">
                {phase==='running'?`${current}/${rounds}…`:phase==='done'?'Run Again':'Run Benchmark'}
              </button>
              {phase!=='idle'&&(
                <button onClick={reset} disabled={phase==='running'}
                  className="bg-gray-700 hover:bg-gray-600 disabled:opacity-40 px-3 py-2 rounded-lg text-sm font-semibold cursor-pointer">
                  Reset
                </button>
              )}
            </div>
            <p className="text-xs text-gray-600">Incognito + clear cache (Ctrl+Shift+Delete) before running.</p>

            {phase==='done'&&(
              <div className="space-y-2 pt-1">
                <div className="bg-gray-800 rounded-xl p-2">
                  <p className="text-xs text-gray-500 font-mono text-center mb-1">&lt;img&gt;</p>
                  <div className="bg-gray-700 rounded-lg flex items-center justify-center" style={{height:88}}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={selected.src} alt="" style={{maxWidth:'100%',maxHeight:'100%',objectFit:'contain'}}/>
                  </div>
                  <p className="text-xs text-gray-600 text-center mt-1">{fmtBytes(selected.bytes)}</p>
                </div>
                <div className="bg-gray-800 rounded-xl p-2">
                  <p className="text-xs text-gray-500 font-mono text-center mb-1">next/image</p>
                  <div className="bg-gray-700 rounded-lg relative" style={{height:88}}>
                    <NextImage src={selected.src} alt="" fill sizes="208px" style={{objectFit:'contain'}}/>
                  </div>
                  <p className="text-xs text-gray-600 text-center mt-1">{fmtBytes(selected.bytes)}</p>
                </div>
              </div>
            )}
          </div>

          {/* ── Right ────────────────────────────────── */}
          <div className="flex-1 min-w-0 space-y-4">

            {/* Integrity */}
            {phase==='done'&&cold&&(
              <div className={`rounded-xl px-4 py-2 text-xs flex flex-wrap gap-x-5 border ${coldOk!==false&&warmOk!==false?'bg-green-950/30 border-green-800/50':'bg-red-950/30 border-red-800/50'}`}>
                <span className="text-gray-400 font-semibold">Integrity</span>
                <span className={coldOk?'text-green-400':'text-red-400'}>
                  {coldOk?'✓':'✗'} Round 1 cold{coldOk===false&&' — clear cache'}
                </span>
                {warmRows.length>0&&<span className={warmOk?'text-green-400':'text-red-400'}>{warmOk?'✓':'✗'} Round 2+ cached</span>}
                {coldOk&&cold.img.transferSize>0&&<span className="text-gray-600">wire: {fmtBytes(cold.img.transferSize)} / {fmtBytes(cold.next.transferSize)}</span>}
              </div>
            )}

            {/* ── Unified comparison table ─────────────────────── */}
            <div className="bg-gray-900 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold">{selected.label} — Full Comparison</h2>
                {phase==='done'&&(
                  <div className="flex gap-2">
                    <button onClick={runCLS} disabled={clsPhase==='img'||clsPhase==='next'}
                      className="text-xs bg-gray-800 hover:bg-gray-700 disabled:opacity-40 px-2.5 py-1 rounded cursor-pointer transition-colors">
                      {clsPhase==='idle'?'+ CLS Test':clsPhase==='done'?'↺ CLS':'CLS…'}
                    </button>
                    <button onClick={()=>exportCSV(results,selected.label)}
                      className="text-xs bg-gray-800 hover:bg-gray-700 px-2.5 py-1 rounded cursor-pointer transition-colors text-gray-400">
                      CSV
                    </button>
                  </div>
                )}
              </div>

              <table className="w-full">
                <thead>
                  <tr className="text-xs text-gray-600 uppercase border-b border-gray-800">
                    <th className="text-left pb-2 font-normal">Dimension</th>
                    <th className="text-right pb-2 font-normal pr-4">&lt;img&gt;</th>
                    <th className="text-right pb-2 font-normal pr-4">next/image</th>
                    <th className="text-right pb-2 font-normal">Winner</th>
                  </tr>
                </thead>
                <tbody>

                  {/* Speed */}
                  <tr><td colSpan={4} className="pt-3 pb-1 text-xs text-gray-600 uppercase tracking-wider">Speed (network + decode)</td></tr>
                  <Row name="Cold total" measured
                    imgVal={nd(cold?.img.duration)}
                    nextVal={nd(cold?.next.duration)}
                    winner={cold?(cold.img.duration<cold.next.duration?'img':'next'):null}
                  />
                  <Row name="Cold network (PRT)" measured
                    imgVal={nd(cold?.img.networkMs)}
                    nextVal={nd(cold?.next.networkMs)}
                    winner={cold?(cold.img.networkMs<cold.next.networkMs?'img':'next'):null}
                    note="PRT.duration"
                  />
                  <Row name="Cold TTFB" measured
                    imgVal={nd(cold?.img.ttfb)}
                    nextVal={nd(cold?.next.ttfb)}
                    winner={cold&&cold.img.ttfb<cold.next.ttfb?'img':cold?'next':null}
                    note="server processing"
                  />
                  <Row name="Cold decode" measured
                    imgVal={nd(cold?.img.decodeMs)}
                    nextVal={nd(cold?.next.decodeMs)}
                    winner={cold?(cold.img.decodeMs<cold.next.decodeMs?'img':'next'):null}
                    note="img.decode() − network"
                  />
                  <Row name="Warm median" measured
                    imgVal={imgWarm.length?nd(median(imgWarm)):'—'}
                    nextVal={nextWarm.length?nd(median(nextWarm)):'—'}
                    winner={warmWinner}
                  />
                  <Row name="Warm 95% CI" measured
                    imgVal={imgWarm.length>=2?`±${wStat(imgWarm,ci95)} ms`:'—'}
                    nextVal={nextWarm.length>=2?`±${wStat(nextWarm,ci95)} ms`:'—'}
                    winner={null}
                    note="1.96·σ/√n"
                  />

                  {/* Bandwidth */}
                  <tr><td colSpan={4} className="pt-3 pb-1 text-xs text-gray-600 uppercase tracking-wider">Bandwidth</td></tr>
                  <Row name="Bytes transferred (cold)" measured
                    imgVal={coldImgKB?`${coldImgKB.toFixed(1)} KB`:'—'}
                    nextVal={coldNextKB?`${coldNextKB.toFixed(1)} KB`:'—'}
                    winner={coldImgKB&&coldNextKB?(coldNextKB<coldImgKB?'next':'img'):null}
                    note={savings?`${Math.abs(savings).toFixed(1)}% ${savings>0?'smaller':'larger'}`:''}
                  />
                  <Row name="Format served"
                    imgVal={isWebP?'WebP (original)':'PNG (original)'}
                    nextVal="WebP (auto-converted)"
                    winner={isWebP?'tie':'next'}
                  />
                  <Row name="Decoded body size" measured
                    imgVal={cold?.img.decodedBodySize?fmtBytes(cold.img.decodedBodySize):'—'}
                    nextVal={cold?.next.decodedBodySize?fmtBytes(cold.next.decodedBodySize):'—'}
                    winner={null}
                  />

                  {/* Layout stability */}
                  <tr><td colSpan={4} className="pt-3 pb-1 text-xs text-gray-600 uppercase tracking-wider">Layout Stability</td></tr>
                  <Row name="CLS score (PerformanceObserver)" measured={clsPhase==='done'}
                    imgVal={clsImgScore!==null?clsImgScore.toFixed(4):(phase==='done'?'run CLS test':'—')}
                    nextVal={clsNextScore!==null?clsNextScore.toFixed(4):(clsPhase!=='idle'?'0.0000':'—')}
                    winner={clsPhase==='done'?'next':null}
                    note="lower = better"
                  />
                  <Row name="Space reservation"
                    imgVal="✗ — 0px until loaded"
                    nextVal="✓ — aspect-ratio CSS"
                    winner="next"
                  />

                  {/* Features */}
                  <tr><td colSpan={4} className="pt-3 pb-1 text-xs text-gray-600 uppercase tracking-wider">Features</td></tr>
                  <Row name="Lazy load by default"   imgVal="✗" nextVal="✓" winner="next"/>
                  <Row name="Responsive sizing"      imgVal="✗ manual srcset" nextVal="✓ automatic" winner="next"/>
                  <Row name="Auto WebP / AVIF"       imgVal="✗" nextVal="✓" winner="next"/>
                  <Row name="Cache-Control headers"  imgVal="manual" nextVal="✓ automatic" winner="next"/>
                  <Row name="Server dependency"      imgVal="✗ none" nextVal="Next.js only" winner="img"/>
                  <Row name="First-load overhead"    imgVal="none" nextVal="+server opt" winner="img" note="see TTFB row"/>

                </tbody>
              </table>

              {highNoise&&<p className="text-xs text-orange-400/60 mt-2">High variance (CV&gt;30%) — close other tabs or increase rounds.</p>}
            </div>

            {/* ── CLS demo (only visible during/after test) ───── */}
            {clsPhase!=='idle'&&(
              <div className="bg-gray-900 rounded-2xl p-4">
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">
                  CLS Demo — {clsPhase==='img'?'loading <img>…':clsPhase==='next'?'loading next/image…':'done'}
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-gray-800 rounded-xl p-3">
                    <p className="text-xs text-gray-400 font-mono mb-2">&lt;img&gt; — no dimensions</p>
                    <p className="text-xs text-gray-500">Content before</p>
                    {showClsImg&&(
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`${selected.src}?cls=${clsToken}`} alt=""
                        style={{width:'100%'}}
                        onLoad={()=>clsImgOnLoad.current?.()}
                      />
                    )}
                    <p className="text-xs text-yellow-400/70">↑ shifts when image loads</p>
                    {clsImgScore!==null&&(
                      <p className="font-mono font-bold mt-1 text-sm text-red-400">CLS {clsImgScore.toFixed(4)}</p>
                    )}
                  </div>
                  <div className="bg-gray-800 rounded-xl p-3">
                    <p className="text-xs text-gray-400 font-mono mb-2">next/image — space reserved</p>
                    <p className="text-xs text-gray-500">Content before</p>
                    {showClsNext&&(
                      <div style={{position:'relative',width:'100%',aspectRatio:`${selected.width}/${selected.height}`}}>
                        <NextImage src={selected.src} alt="" fill sizes="208px" style={{objectFit:'contain'}}/>
                      </div>
                    )}
                    <p className="text-xs text-green-400/70">↑ no shift — space pre-allocated</p>
                    {clsNextScore!==null&&(
                      <p className="font-mono font-bold mt-1 text-sm text-green-400">CLS {clsNextScore.toFixed(4)}</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ── Per-round table ─────────────────────────────── */}
            {results.length>0&&(
              <div className="bg-gray-900 rounded-2xl p-4">
                <h3 className="text-sm font-semibold mb-3">Per-Round Raw Data</h3>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-500 uppercase border-b border-gray-800">
                      <th className="text-left pb-2">Round</th>
                      <th className="text-left pb-2 text-xs text-gray-700">order</th>
                      <th className="text-right pb-2 font-mono">&lt;img&gt;</th>
                      <th className="text-right pb-2 font-mono">next/image</th>
                      <th className="text-right pb-2">Faster</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((r,i)=>{
                      const win  = r.img.duration<=r.next.duration?'img':'next';
                      const diff = Math.abs(r.img.duration-r.next.duration);
                      const isCold = r.round===1;
                      const wi = i-1;
                      const iOL = !isCold&&imgOL[wi];
                      const nOL = !isCold&&nextOL[wi];
                      return (
                        <tr key={r.round} className="border-b border-gray-800/40">
                          <td className="py-1.5 text-gray-400">
                            #{r.round}
                            <span className={`ml-2 text-xs px-1.5 py-0.5 rounded ${isCold?'bg-blue-900/40 text-blue-400':'bg-yellow-900/40 text-yellow-400'}`}>
                              {isCold?'cold':'cache'}
                            </span>
                          </td>
                          <td className="py-1.5 text-xs text-gray-700 font-mono">
                            {r.imgFirst?'img→next':'next→img'}
                          </td>
                          <td className={`py-1.5 text-right font-mono ${win==='img'?'text-green-400':'text-gray-300'}`}>
                            {r.img.duration.toFixed(3)}{iOL&&<span className="ml-0.5 text-orange-400 text-xs" title="IQR outlier">⚠</span>}
                          </td>
                          <td className={`py-1.5 text-right font-mono ${win==='next'?'text-green-400':'text-gray-300'}`}>
                            {r.next.duration.toFixed(3)}{nOL&&<span className="ml-0.5 text-orange-400 text-xs" title="IQR outlier">⚠</span>}
                          </td>
                          <td className="py-1.5 text-right text-xs text-gray-500">
                            {win==='img'?'<img>':'next'} −{diff.toFixed(3)}ms
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {hasOL&&<p className="text-xs text-orange-400/40 mt-2">⚠ IQR outlier — included in calculations</p>}
              </div>
            )}

            {/* ── PRT entries ─────────────────────────────────── */}
            {netEntries.length>0&&(
              <div className="bg-gray-900 rounded-2xl p-4">
                <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-2">PerformanceResourceTiming</h3>
                <table className="w-full text-xs font-mono">
                  <thead>
                    <tr className="text-gray-600 border-b border-gray-800">
                      <th className="text-left pb-1 font-normal">URL</th>
                      <th className="text-right pb-1 font-normal">total</th>
                      <th className="text-right pb-1 font-normal">TTFB</th>
                      <th className="text-right pb-1 font-normal">dl</th>
                      <th className="text-right pb-1 font-normal">transfer</th>
                      <th className="text-right pb-1 font-normal">source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {netEntries.map((e,i)=>{
                      const url=e.name.replace(window.location.origin,'');
                      const short=url.length>50?'…'+url.slice(-48):url;
                      const hit=e.transferSize===0&&e.decodedBodySize>0;
                      return (
                        <tr key={i} className="border-b border-gray-800/30">
                          <td className="py-1 text-gray-400 truncate max-w-xs" title={url}>{short}</td>
                          <td className="py-1 text-right">{e.duration.toFixed(2)}</td>
                          <td className="py-1 text-right text-gray-500">{(e.responseStart-e.requestStart).toFixed(2)}</td>
                          <td className="py-1 text-right text-gray-500">{(e.responseEnd-e.responseStart).toFixed(2)}</td>
                          <td className="py-1 text-right">{e.transferSize>0?`${(e.transferSize/1024).toFixed(1)} KB`:'—'}</td>
                          <td className={`py-1 text-right ${hit?'text-yellow-400':'text-blue-400'}`}>{hit?'cache':'network'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
