# Next/Image vs img Tag Benchmark

A benchmarking tool that compares the load time of `next/image` and the native `<img>` tag in a real Next.js environment.

Live: [https://next-image-vs-img-benchmark.vercel.app/](https://next-image-vs-img-benchmark.vercel.app/)

---

## Measurement Method

### Timer start point
Both loaders (`ImgLoader`, `NextLoader`) record the start time in `useLayoutEffect`:

```ts
useLayoutEffect(() => {
  startRef.current = performance.now();
}, []);
```

`useLayoutEffect` runs after the DOM is committed but before the browser paints — this is the earliest reliable moment to start timing, minimizing React scheduling overhead.

### Timer end point
The elapsed time is captured in the `onLoad` event:

```ts
onLoad={() => report(performance.now() - startRef.current)}
```

This measures: **from when the element enters the DOM → to when the image has fully decoded and is ready to display**.

### Cached image fallback
If the browser has already cached the image, `onLoad` fires synchronously before React can attach the handler. This is caught with:

```ts
useEffect(() => {
  if (imgRef.current?.complete) report(performance.now() - startRef.current);
}, []);
```

Without this, cached images would never report and the benchmark would hang.

### Double-report guard
Each loader has a `reported` ref that ensures `onLoaded` is called at most once, even if both `onLoad` and the `complete` fallback fire:

```ts
const report = (ms: number) => {
  if (reported.current) return;
  reported.current = true;
  onLoaded(Math.max(0, ms));
};
```

---

## How Each Method Is Loaded

### `<img>` (ImgLoader)
Requests the raw file directly from the `/public` directory:

```
/wooseok-800x800.png
```

No transformation, no optimization — pure file transfer time.

### `next/image` (NextLoader)
Does **not** use the `<NextImage>` component. Instead, it hits the `/_next/image` optimizer API directly via a plain `<img>` element:

```
/_next/image?url=%2Fwooseok-800x800.png&w=828&q=75
```

This includes:
- Server-side WebP conversion (first request only — result is cached server-side after)
- Resizing to the nearest allowed width
- Quality set to 75

The `w` parameter is selected from Next.js's allowed widths `[16, 32, 48, 64, 96, 128, 256, 384, 640, 750, 828, 1080, 1200, 1920, 2048, 3840]` — the smallest value that is ≥ the image's declared width.

The reason for using a plain `<img>` instead of `<NextImage>` is to get a direct `ref` to the DOM element, which is required for the `img.complete` cached-image fallback.

---

## Round Execution

### Round isolation
Each round remounts both loaders by changing the `key` prop:

```ts
setRoundKey(k => k + 1);
// used as: key={`img-${roundKey}`}  key={`next-${roundKey}`}
```

React unmounts and remounts the component on every key change, guaranteeing a fresh timer, fresh `reported` flag, and a fresh image request (for cached images, the browser serves from cache — intentional for rounds 2+).

### Round completion gate
A round is recorded only when **both** loaders have reported:

```ts
const tryFinish = () => {
  const { img, next } = pending.current;
  if (img == null || next == null) return;  // wait for both
  // record result, advance to next round
};
```

### Round interval
300ms gap between rounds to let the browser settle:

```ts
setTimeout(() => nextRound(round + 1), 300);
```

### `roundRef` instead of state
The current round number is stored in a ref, not state:

```ts
const roundRef = useRef(0);
```

This prevents stale closure bugs in `tryFinish` — if it were state, the closure captured at callback creation time would hold the old value.

---

## Cache State Per Round

| Round    | State   | Why                                                                 |
| -------- | ------- | ------------------------------------------------------------------- |
| Round 1  | `cold`  | First request — browser has no cached version (if cache was cleared) |
| Round 2+ | `cache` | Same URL — browser serves from disk/memory cache                    |

`cold` / `cache` badges in the UI: `isCold = r.round === 1`

Both methods use the **same URL** with no cache-busting parameters, so they always face identical cache conditions. The comparison is always apples-to-apples.

---

## Winner Determination

### Per-round winner
```ts
const rWinner = r.imgMs <= r.nextMs ? 'img' : 'next';
```
Whichever loaded in fewer milliseconds wins the round. Ties go to `<img>`.

### Overall winner (average card)
```ts
const avgImg  = results.reduce((s, r) => s + r.imgMs,  0) / results.length;
const avgNext = results.reduce((s, r) => s + r.nextMs, 0) / results.length;
const winner  = avgImg <= avgNext ? 'img' : 'next';
```
Simple arithmetic mean across all rounds. The winner is the method with the lower average. This means a slow Round 1 (cold) will pull up `next/image`'s average more than `<img>`'s, since `next/image` has extra optimization overhead on first request.

---

## What Is and Is Not Measured

**Measured:**
- Network transfer time (cold)
- Browser cache lookup time (warm)
- Next.js server-side image optimization time (included in `next/image` Round 1)
- Image decoding time (included in both, ends at `onLoad`)

**Not measured:**
- Layout / paint time after load
- Lazy-loading behavior
- CLS (Cumulative Layout Shift) impact
- WebP conversion savings on file size (visible in the file metadata panel)
- Long-term CDN caching behavior

---

## Test Environment

For accurate results:

1. **Open in incognito mode** — eliminates cache from previous sessions
2. **Clear all cache** — `Ctrl+Shift+Delete` (Windows) / `Cmd+Shift+Delete` (Mac)
3. **Click Run Benchmark** — Round 1 = cold (network request)
4. **Click Run Again** — all rounds reflect cached performance

---

## How to Read Results

```
Round   <img>        next/image     Faster
#1      142.3 ms     187.6 ms       <img> -45.3ms      <- cold (network + optimization overhead)
#2        1.2 ms       0.8 ms       next/image -0.4ms  <- cache
#3        1.1 ms       0.9 ms       next/image -0.2ms  <- cache
```

- **Round 1 cold gap**: The difference here is mainly Next.js server-side WebP optimization overhead. After that first request, the optimized image is cached on the server and the overhead disappears.
- **Round 2+ cache gap**: Both methods are sub-2ms. The differences are measurement noise, not meaningful performance differences.
- **Average**: Weighted across all rounds. More rounds = Round 1 cold cost is diluted. With 10 rounds, the average approaches pure cache performance for both.

> The real advantage of `next/image` is not raw load speed — it's automatic WebP conversion, proper sizing, lazy loading, and CLS prevention. Load time alone does not capture the full picture.

---

## Dev Environment

| Item         | Version  |
| ------------ | -------- |
| Node.js      | v20.18.0 |
| npm          | v11.0.0  |
| Next.js      | 16.2.9   |
| React        | 19.2.4   |
| TypeScript   | ^5       |
| Tailwind CSS | ^4       |

## Getting Started

```bash
npm install
npm run dev
```
