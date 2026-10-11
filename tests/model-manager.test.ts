import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  classifyPullError,
  diskCheck,
  DISK_HEADROOM_BYTES,
  formatEta,
  formatProgress,
  formatSpeed,
  MODEL,
  MODEL_BYTES,
  ModelManager,
  ProgressTracker,
  PullError,
  type PullProgress,
} from '../lib/model-manager.ts';

const GB = 1e9;

describe('ProgressTracker', () => {
  it('sums layers and computes percent', () => {
    const t = new ProgressTracker();
    t.update({ status: 'pulling manifest' }, 0);
    t.update({ status: 'pulling a', digest: 'a', total: 4 * GB, completed: 1 * GB }, 0);
    const p = t.update({ status: 'pulling b', digest: 'b', total: 0.3 * GB, completed: 0.3 * GB }, 0);
    expect(p.totalBytes).toBe(4.3 * GB);
    expect(p.completedBytes).toBe(1.3 * GB);
    expect(p.percent).toBeCloseTo(30.23, 1);
  });

  it('measures speed over the window and derives the ETA', () => {
    const t = new ProgressTracker(5_000);
    expect(t.update({ digest: 'a', total: 4 * GB, completed: 0 }, 0).bytesPerSec).toBeNull();
    t.update({ digest: 'a', total: 4 * GB, completed: 50e6 }, 1_000);
    const p = t.update({ digest: 'a', total: 4 * GB, completed: 100e6 }, 2_000);
    expect(p.bytesPerSec).toBe(50e6);
    expect(p.etaSec).toBe((4 * GB - 100e6) / 50e6);
  });

  it('forgets samples older than the window', () => {
    const t = new ProgressTracker(5_000);
    t.update({ digest: 'a', total: 4 * GB, completed: 0 }, 0);
    // Fast start, then slow: speed follows the recent rate.
    t.update({ digest: 'a', total: 4 * GB, completed: 1 * GB }, 1_000);
    for (let s = 2; s <= 20; s++) t.update({ digest: 'a', total: 4 * GB, completed: GB + (s - 1) * 10e6 }, s * 1_000);
    const p = t.update({ digest: 'a', total: 4 * GB, completed: GB + 20 * 10e6 }, 21_000);
    expect(p.bytesPerSec).toBeCloseTo(10e6, -3);
  });

  it('treats a resumed pull like any other start: speed from new bytes only', () => {
    const t = new ProgressTracker();
    t.update({ digest: 'a', total: 4 * GB, completed: 2 * GB }, 0);
    const p = t.update({ digest: 'a', total: 4 * GB, completed: 2 * GB + 20e6 }, 2_000);
    expect(p.percent).toBeCloseTo(50.5, 1);
    expect(p.bytesPerSec).toBe(10e6);
  });

  it('does not show 100% after a small first layer when the full size is known', () => {
    const t = new ProgressTracker(5_000, 4.3 * GB);
    let p = t.update({ digest: 'mmproj', total: 1 * GB, completed: 1 * GB }, 0);
    expect(p.totalBytes).toBe(4.3 * GB);
    expect(p.percent).toBeCloseTo(23.3, 1);
    p = t.update({ digest: 'weights', total: 3.25 * GB, completed: 0.6 * GB }, 1_000);
    expect(p.totalBytes).toBe(4.25 * GB);
  });

  it('ends at 100 percent on success', () => {
    const t = new ProgressTracker();
    t.update({ digest: 'a', total: 100, completed: 90 }, 0);
    const p = t.update({ status: 'success' }, 10);
    expect(p.percent).toBe(100);
    expect(p.etaSec).toBe(0);
  });
});

describe('formatting', () => {
  const base: PullProgress = { status: 'pulling a', completedBytes: 1.2 * GB, totalBytes: 4.3 * GB, percent: 28, bytesPerSec: 12.9e6, etaSec: 240 };

  it('writes the plain status line', () => {
    expect(formatProgress(base)).toBe('Downloading the writing model, 1.2 of 4.3 GB, about 4 min left');
    expect(formatProgress({ ...base, etaSec: null })).toBe('Downloading the writing model, 1.2 of 4.3 GB');
    expect(formatProgress({ ...base, totalBytes: 0 })).toBe('Connecting to the download server');
    expect(formatProgress({ ...base, status: 'verifying sha256 digest' })).toBe('Checking the download');
  });

  it('formats ETA and speed', () => {
    expect(formatEta(null)).toBe('');
    expect(formatEta(30)).toBe('less than a minute left');
    expect(formatEta(89)).toBe('about 1 min left');
    expect(formatEta(3 * 3600 + 5 * 60)).toBe('about 3 h 5 min left');
    expect(formatSpeed(12.94e6)).toBe('12.9 MB/s');
    expect(formatSpeed(null)).toBe('');
  });
});

describe('diskCheck', () => {
  it('needs the model plus 1 GB headroom', () => {
    const need = MODEL_BYTES + DISK_HEADROOM_BYTES;
    expect(need).toBe(5.3 * GB);
    expect(diskCheck(need).ok).toBe(true);
    expect(diskCheck(need - 1).ok).toBe(false);
    expect(diskCheck(null).ok).toBe(true);
  });

  it('needs only the rest of a resumed download plus headroom', () => {
    const r = diskCheck(2.5 * GB, 3 * GB);
    expect(r.needBytes).toBeCloseTo(1.3 * GB + DISK_HEADROOM_BYTES, -3);
    expect(r.ok).toBe(true);
    expect(diskCheck(2 * GB, 1 * GB).ok).toBe(false);
    // More on disk than the model (other files): headroom still needed.
    expect(diskCheck(0.5 * GB, 9 * GB).ok).toBe(false);
  });
});

describe('classifyPullError', () => {
  it('maps Ollama messages to kinds', () => {
    expect(classifyPullError('pull model manifest: Get "https://registry.ollama.ai/v2/...": dial tcp: lookup registry.ollama.ai: no such host')).toBe('offline');
    expect(classifyPullError('write /x/blobs/sha256-partial: no space left on device')).toBe('disk');
    expect(classifyPullError('max retries exceeded: unexpected EOF')).toBe('offline');
    expect(classifyPullError('file does not exist')).toBe('other');
  });
});

// Like fetch: an abort of `signal` errors the body stream.
function ndjsonResponse(lines: object[], { hang = false, signal }: { hang?: boolean; signal?: AbortSignal | null } = {}): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(ctrl) {
      for (const l of lines) ctrl.enqueue(enc.encode(JSON.stringify(l) + '\n'));
      if (!hang) ctrl.close();
      signal?.addEventListener('abort', () => ctrl.error(new DOMException('aborted', 'AbortError')));
    },
  });
  return new Response(body, { status: 200 });
}

describe('ModelManager', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('pulls and reports progress until success', async () => {
    const fetchMock = vi.fn(async () =>
      ndjsonResponse([
        { status: 'pulling manifest' },
        { status: 'pulling a', digest: 'a', total: 1000, completed: 500 },
        { status: 'pulling a', digest: 'a', total: 1000, completed: 1000 },
        { status: 'verifying sha256 digest' },
        { status: 'success' },
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);
    const seen: PullProgress[] = [];
    await new ModelManager('http://127.0.0.1:11535/', 'tiny:1b').pull((p) => seen.push(p));
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:11535/api/pull', expect.objectContaining({ method: 'POST' }));
    expect(seen.map((p) => p.percent)).toEqual([null, 50, 100, 100, 100]);
  });

  it('turns a stream error into a PullError with a kind', async () => {
    vi.stubGlobal('fetch', async () => ndjsonResponse([{ status: 'pulling manifest' }, { error: 'dial tcp: lookup registry.ollama.ai: no such host' }]));
    const err = await new ModelManager('http://x').pull(() => {}).catch((e) => e);
    expect(err).toBeInstanceOf(PullError);
    expect(err.kind).toBe('offline');
  });

  it('reports an unreachable backend', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Load failed');
    });
    const err = await new ModelManager('http://x').pull(() => {}).catch((e) => e);
    expect(err.kind).toBe('backend');
  });

  it('cancels a running pull', async () => {
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      return ndjsonResponse([{ status: 'pulling a', digest: 'a', total: 1000, completed: 10 }], { hang: true, signal: init.signal });
    });
    const ctrl = new AbortController();
    const p = new ModelManager('http://x').pull(() => ctrl.abort(), ctrl.signal);
    await expect(p).rejects.toBeDefined();
    expect(ctrl.signal.aborted).toBe(true);
  });

  it('fails a stalled pull instead of hanging', async () => {
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      return ndjsonResponse([{ status: 'pulling manifest' }], { hang: true, signal: init.signal });
    });
    const err = await new ModelManager('http://x', MODEL, 50).pull(() => {}).catch((e) => e);
    expect(err).toBeInstanceOf(PullError);
    expect(err.kind).toBe('offline');
  });

  it('finds the model in /api/tags', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ models: [{ name: 'other:1b' }, { name: MODEL, model: MODEL }] }));
    expect(await new ModelManager('http://x').isInstalled()).toBe(true);
    vi.stubGlobal('fetch', async () => Response.json({ models: [] }));
    expect(await new ModelManager('http://x').isInstalled()).toBe(false);
  });
});
