> [!CAUTION]
> ## This benchmark measures one thing only: how fast the **first image load** completes (cold network + decode time).
> It does **not** measure lazy loading, resource contention, real page rendering, or any warm-cache scenario beyond Round 2+.
> Use it to answer: *"Is `/_next/image` endpoint faster or slower than serving a static file directly on the first request?"*

# Next/Image vs img Tag Benchmark

Compares `next/image` and `<img>` across **speed, bandwidth, and layout stability** in a real Next.js environment.

Live: [https://next-image-vs-img-benchmark.vercel.app/](https://next-image-vs-img-benchmark.vercel.app/)

---

## What Is Measured

| Dimension | Method | Source |
|---|---|---|
| Cold total time | network + decode | `performance.now()` around `img.decode()` |
| Cold network time | bytes received | `PerformanceResourceTiming.duration` |
| Cold TTFB | server processing | `responseStart − requestStart` |
| Cold decode time | image rasterisation | `total − networkMs` |
| Warm median / 95% CI | cache performance | same, across Round 2+ |
| Bytes transferred | wire size | `PRT.transferSize` |
| Format served | original vs WebP | URL + content-type |
| Decoded body size | cache size | `PRT.decodedBodySize` |
| CLS score | layout shift | `PerformanceObserver(layout-shift)` |

---

## Timing Method

### Why `img.decode()` instead of `onload`

`onload` fires when the browser has received the last byte. Depending on the browser and image size, decode may still be in progress. `img.decode()` resolves only after the image is fully rasterised and safe to composite — which is when it is actually *visible* to the user.

```ts
const img = new Image();
img.src = url;
const t0 = performance.now();
await img.decode();               // network + decode complete
const elapsed = performance.now() - t0;
```

The breakdown:

```
networkMs = PRT.duration           // fetchStart → responseEnd
decodeMs  = elapsed − networkMs    // rasterisation after bytes arrived
total     = elapsed                // what we report
```

### Why `new Image()` instead of a React component

`new Image()` is used so timing is fully imperative — no React scheduling overhead between the two measurements. The trade-off is documented in [Known Limitations](#known-limitations).

### Why `PerformanceResourceTiming`

`PRT` is measured at the browser network stack level, below JavaScript. It gives sub-millisecond precision for network phases (TTFB, download) that `performance.now()` can't isolate cleanly.

---

## How Each Method Is Loaded

### `<img>`

```
/wooseok-200kb.png?_cb=<runId>
```

Raw file served from `/public`. No transformation. `runId` is a random string generated once per benchmark run, making Round 1 always cold. Rounds 2+ reuse the same URL so the browser serves from cache.

### `next/image`

```
/_next/image?url=%2Fwooseok-200kb.png&w=1920&q=75&_cb=<runId>
```

The `/_next/image` optimizer endpoint is called directly via `new Image()` — **not** the `<NextImage>` React component. This is intentional: the React component adds lazy-loading, placeholder, and priority logic that are separate concerns from raw load time.

Parameters:
- `w` — smallest allowed width ≥ source image width, from `[16, 32, 48, 64, 96, 128, 256, 384, 640, 750, 828, 1080, 1200, 1920, 2048, 3840]`
- `q=75` — default Next.js quality
- `_cb=<runId>` — top-level param ignored by Next.js optimizer but treated as a unique URL by the browser

On the **first request**, the server converts the image to WebP and caches the result. Subsequent requests for the same `url+w+q` are served from the server cache — which is why Round 2+ TTFB for `next/image` is similar to `<img>`.

---

## Round Execution

### Order randomisation

Each round independently randomises which method runs first:

```ts
const imgFirst = Math.random() > 0.5;
const firstUrl  = imgFirst ? imgUrl  : nextUrl;
const secondUrl = imgFirst ? nextUrl : imgUrl;
```

This cancels the TCP/HTTP2 connection reuse bias: the first request in a pair always pays connection setup cost; without randomisation, `<img>` would always absorb it.

The per-round table shows which order was used: `img→next` or `next→img`.

### Inter-measurement gap

150 ms between the two measurements within a round (let previous decode settle), 300 ms between rounds.

### Cache isolation per run

`runId` is generated once per `Run Benchmark` click. All rounds within a run use the same URL, so:

| Round | Cache state | Why |
|---|---|---|
| Round 1 | cold | Browser has never seen `?_cb=<runId>` |
| Round 2+ | cache | Same URL — browser disk/memory cache |

A new run generates a new `runId` — Round 1 is always cold.

---

## Statistics

### Warm rounds (Round 2+)

| Stat | Formula |
|---|---|
| Median | middle value after sort |
| Mean | arithmetic mean |
| σ (stddev) | population standard deviation |
| 95% CI | `1.96 · σ / √n` |

The median is the primary warm metric — it is robust to outliers. The 95% CI shows how tightly the samples cluster: a wide CI means the result is unreliable.

### Outlier detection

Warm rounds are checked with Tukey's IQR fence:

```
Q1 = 25th percentile
Q3 = 75th percentile
IQR = Q3 − Q1
outlier if value < Q1 − 1.5·IQR  or  value > Q3 + 1.5·IQR
```

Outliers are flagged (⚠) but **included in all calculations**. Excluding data silently would undermine reproducibility.

### Noise warning

If the coefficient of variation (σ / mean) exceeds 30% for warm rounds, a warning is shown. Common causes: competing background network activity, browser timer coarsening, other tabs.

### Integrity check

After each run, `PRT.transferSize` is checked:

- Round 1: `transferSize > 0` → confirmed cold (real network hit)
- Round 2+: `transferSize === 0 && decodedBodySize > 0` → confirmed cache hit

If either check fails, a warning is shown and results should not be trusted.

---

## CLS Test

The CLS test uses the official `PerformanceObserver` API with the `layout-shift` event type — not a pixel-displacement proxy.

```ts
let cls = 0;
const observer = new PerformanceObserver(list => {
  for (const entry of list.getEntries()) {
    const ls = entry as LayoutShift;
    if (!ls.hadRecentInput) cls += ls.value;  // sum layout shift scores
  }
});
observer.observe({ type: 'layout-shift', buffered: false });
```

CLS score = sum of `impact_fraction × distance_fraction` per shift event.

### `<img>` without dimensions

The element renders at 0 px height. When the image loads, it expands to its natural height — pushing all subsequent content down. This shift is recorded by the observer.

### `next/image` with dimensions

The component injects `aspect-ratio: <width>/<height>` via CSS at mount time. The container already has its final height before a single byte is fetched. When the image loads, no element positions change — CLS score ≈ 0.

### Limitation

The observer captures **all** layout shifts on the page during the measurement window — not only those from the test images. For a clean measurement, keep the page static and avoid scrolling during the test.

---

## Known Limitations

| # | Limitation | Impact |
|---|---|---|
| ① | Uses `new Image()`, not a DOM render | Lazy loading, priority hints, placeholder, and CLS prevention from `<NextImage>` are not exercised |
| ② | Measures `/_next/image` endpoint, not `<NextImage>` component | The React component adds scheduling overhead not captured here |
| ③ | TCP/TLS reused across rounds | Rounds are not fully independent; Round 1 pays connection setup, later rounds do not |
| ④ | No CPU throttle | On fast developer machines, decode time is understated vs. a mobile device |
| ⑤ | No network throttle | Set manually in DevTools (Fast 3G / Slow 4G) for realistic network conditions |
| ⑥ | CLS window may include other page shifts | Keep the page static and avoid scrolling during the CLS test |

---

## Test Environment

1. **Open in incognito mode** — no cache from previous sessions
2. **Clear all cache** — `Ctrl+Shift+Delete` (Windows) / `Cmd+Shift+Delete` (Mac)
3. **Run Benchmark** — Round 1 is always cold (new `runId`)
4. **Run CLS Test** — requires the test area to be visible in the viewport

Optional: in Chrome DevTools → Network → throttle to Fast 3G for a more representative result.

---

## Test Images

All images are the same photo exported at different sizes and formats:

| File | Dimensions | Format | File size |
|---|---|---|---|
| wooseok-50kb.png | 1000 × 800 | PNG | 42.9 KB |
| wooseok-50kb.webp | 1000 × 800 | WebP | 37.2 KB |
| wooseok-100kb.png | 1400 × 1000 | PNG | 57.2 KB |
| wooseok-100kb.webp | 1400 × 1000 | WebP | 50.6 KB |
| wooseok-200kb.png | 1800 × 1400 | PNG | 81.7 KB |
| wooseok-200kb.webp | 1800 × 1400 | WebP | 88.7 KB |
| wooseok-300kb.png | 2200 × 1600 | PNG | 94.6 KB |
| wooseok-300kb.webp | 2200 × 1600 | WebP | 108.3 KB |
| wooseok-400kb.png | 2600 × 1800 | PNG | 113.4 KB |
| wooseok-400kb.webp | 2600 × 1800 | WebP | 162.8 KB |
| wooseok-500kb.png | 3000 × 2000 | PNG | 130.8 KB |
| wooseok-500kb.webp | 3000 × 2000 | WebP | 186.6 KB |

---

## Dev Environment

| Item | Version |
|---|---|
| Node.js | v20.18.0 |
| npm | v11.0.0 |
| Next.js | 16.2.9 |
| React | 19.2.4 |
| TypeScript | ^5 |
| Tailwind CSS | ^4 |

## Getting Started

```bash
npm install
npm run dev
```
