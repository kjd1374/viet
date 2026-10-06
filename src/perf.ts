// 동작 확정 → 다음 카드가 그려진 다음 프레임까지의 시간.
// 이중 rAF로 측정하므로 실제 페인트 시점보다 같거나 약간 늦은(보수적인) 값이다.

const samples: number[] = [];
let t0: number | null = null;
const listeners = new Set<() => void>();

export const perf = {
  start() {
    t0 = performance.now();
  },
  cancel() {
    t0 = null;
  },
  end() {
    if (t0 === null) return;
    const start = t0;
    t0 = null;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        samples.push(performance.now() - start);
        listeners.forEach((l) => l());
      }),
    );
  },
  stats() {
    if (!samples.length) return { n: 0, p50: 0, p95: 0, max: 0 };
    const s = [...samples].sort((a, b) => a - b);
    const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
    return { n: s.length, p50: q(0.5), p95: q(0.95), max: s[s.length - 1] };
  },
  samples: () => [...samples],
  reset() {
    samples.length = 0;
    listeners.forEach((l) => l());
  },
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

Object.assign(window, { __perf: perf });
