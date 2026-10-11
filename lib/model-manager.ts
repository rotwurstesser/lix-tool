// Downloads and checks the writing model through the bundled Ollama.

export const MODEL = 'gemma4:e2b-it-qat';
export const MODEL_BYTES = 4_300_000_000;
export const DISK_HEADROOM_BYTES = 1_000_000_000;
// A pull that sends nothing for this long counts as broken.
export const STALL_TIMEOUT_MS = 60_000;

const GB = 1e9;
const MB = 1e6;

/** One line of the /api/pull stream. */
export interface PullEvent {
  status?: string;
  digest?: string;
  total?: number;
  completed?: number;
  error?: string;
}

export interface PullProgress {
  status: string;
  completedBytes: number;
  totalBytes: number;
  /** 0..100, or null before the size is known. */
  percent: number | null;
  /** Bytes per second over the last few seconds, or null while unknown. */
  bytesPerSec: number | null;
  /** Seconds left, or null while unknown. */
  etaSec: number | null;
}

/**
 * Disk rule: the rest of the model plus headroom must fit. Bytes already on disk
 * (a partial download) count as done. Unknown free space does not block.
 */
export function diskCheck(freeBytes: number | null, onDiskBytes = 0) {
  const needBytes = Math.max(0, MODEL_BYTES - onDiskBytes) + DISK_HEADROOM_BYTES;
  return { ok: freeBytes === null || freeBytes >= needBytes, needBytes, freeBytes };
}

/** Sums the layers of a pull and measures speed over a sliding time window. */
export class ProgressTracker {
  private layers = new Map<string, { total: number; completed: number }>();
  private samples: Array<{ t: number; bytes: number }> = [];
  private status = 'pulling manifest';

  /**
   * Ollama reports layers one by one, so the sum of totals grows during a pull.
   * `expectedTotal` keeps the bar from showing 100% after a small first layer.
   */
  constructor(
    private readonly windowMs = 5_000,
    private readonly expectedTotal = 0,
  ) {}

  update(ev: PullEvent, nowMs: number): PullProgress {
    if (ev.status) this.status = ev.status;
    if (ev.digest && ev.total) {
      this.layers.set(ev.digest, { total: ev.total, completed: Math.min(ev.completed ?? 0, ev.total) });
    }
    let completedBytes = 0;
    let totalBytes = 0;
    for (const l of this.layers.values()) {
      completedBytes += l.completed;
      totalBytes += l.total;
    }
    if (ev.status === 'success') completedBytes = totalBytes;
    else if (totalBytes > 0 && totalBytes < 0.9 * this.expectedTotal) totalBytes = this.expectedTotal;

    this.samples.push({ t: nowMs, bytes: completedBytes });
    while (this.samples.length > 2 && nowMs - this.samples[1].t >= this.windowMs) this.samples.shift();
    const first = this.samples[0];
    const dt = (nowMs - first.t) / 1000;
    const bytesPerSec = dt >= 1 ? Math.max(0, (completedBytes - first.bytes) / dt) : null;
    const left = totalBytes - completedBytes;
    const etaSec = bytesPerSec ? left / bytesPerSec : left === 0 && totalBytes > 0 ? 0 : null;

    return {
      status: this.status,
      completedBytes,
      totalBytes,
      percent: totalBytes > 0 ? (100 * completedBytes) / totalBytes : null,
      bytesPerSec,
      etaSec,
    };
  }
}

export function formatGB(bytes: number): string {
  return (bytes / GB).toFixed(1);
}

export function formatSpeed(bytesPerSec: number | null): string {
  return bytesPerSec === null ? '' : `${(bytesPerSec / MB).toFixed(1)} MB/s`;
}

export function formatEta(sec: number | null): string {
  if (sec === null || !Number.isFinite(sec)) return '';
  if (sec < 60) return 'less than a minute left';
  const min = Math.round(sec / 60);
  if (min < 60) return `about ${min} min left`;
  return `about ${Math.floor(min / 60)} h ${min % 60} min left`;
}

/** Plain status line, e.g. "Downloading the writing model, 1.2 of 4.3 GB, about 4 min left". */
export function formatProgress(p: PullProgress): string {
  if (p.status.startsWith('verifying')) return 'Checking the download';
  if (p.status.startsWith('writing') || p.status === 'success') return 'Finishing the setup of the writing model';
  if (!p.totalBytes) return 'Connecting to the download server';
  const parts = [`Downloading the writing model, ${formatGB(p.completedBytes)} of ${formatGB(p.totalBytes)} GB`];
  const eta = formatEta(p.etaSec);
  if (eta) parts.push(eta);
  return parts.join(', ');
}

export type PullErrorKind = 'offline' | 'disk' | 'backend' | 'other';

export class PullError extends Error {
  constructor(
    readonly kind: PullErrorKind,
    readonly detail: string,
  ) {
    super(PULL_MESSAGES[kind] + (kind === 'other' ? ` (${detail})` : ''));
    this.name = 'PullError';
  }
}

export const PULL_MESSAGES: Record<PullErrorKind, string> = {
  offline: 'No internet connection, or the download server does not answer. Check the connection and try again.',
  disk: 'The disk is full. Free some space and try again.',
  backend: 'The writing engine does not respond.',
  other: 'The download failed.',
};

/** Maps an Ollama pull error to a kind the UI can explain. */
export function classifyPullError(message: string): PullErrorKind {
  const m = message.toLowerCase();
  if (/no space left|disk full|not enough space|insufficient space/.test(m)) return 'disk';
  if (/no such host|dial tcp|network is unreachable|i\/o timeout|connection reset|tls handshake|max retries|stalled|eof/.test(m)) {
    return 'offline';
  }
  return 'other';
}

function sameModel(name: unknown, model: string): boolean {
  return typeof name === 'string' && (name === model || name === `${model}:latest`);
}

export class ModelManager {
  readonly baseUrl: string;

  constructor(
    baseUrl: string,
    readonly model = MODEL,
    private readonly stallMs = STALL_TIMEOUT_MS,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  /** True when /api/tags lists the model. */
  async isInstalled(signal?: AbortSignal): Promise<boolean> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/tags`, { signal: signal ?? AbortSignal.timeout(10_000) });
    } catch (err) {
      if (signal?.aborted) throw err;
      throw new PullError('backend', String(err));
    }
    if (!res.ok) throw new PullError('backend', `HTTP ${res.status}`);
    const data = (await res.json()) as { models?: Array<{ name?: string; model?: string }> };
    return (data.models ?? []).some((m) => sameModel(m.name, this.model) || sameModel(m.model, this.model));
  }

  /** Deletes the model files, so the next pull downloads every part again. A missing model is fine. */
  async remove(): Promise<void> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/delete`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      throw new PullError('backend', String(err));
    }
    if (!res.ok && res.status !== 404) throw new PullError('backend', `HTTP ${res.status}`);
  }

  /** Pulls the model. Cancel with `signal`; pulling again resumes where it stopped. */
  async pull(onProgress: (p: PullProgress) => void, signal?: AbortSignal): Promise<void> {
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort(signal?.reason);
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
    let stalled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const kick = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        stalled = true;
        ctrl.abort();
      }, this.stallMs);
    };

    const tracker = new ProgressTracker(5_000, this.model === MODEL ? MODEL_BYTES : 0);
    try {
      kick();
      let res: Response;
      try {
        res = await fetch(`${this.baseUrl}/api/pull`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: this.model, stream: true }),
          signal: ctrl.signal,
        });
      } catch (err) {
        if (signal?.aborted) throw err;
        if (stalled) throw new PullError('offline', 'stalled');
        throw new PullError('backend', String(err));
      }
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => '');
        throw new PullError(classifyPullError(text), `HTTP ${res.status} ${text.slice(0, 200)}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let done = false;
      while (!done) {
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {
          chunk = await reader.read();
        } catch (err) {
          if (signal?.aborted) throw err;
          if (stalled) throw new PullError('offline', 'The download stalled');
          throw new PullError('backend', String(err));
        }
        kick();
        if (chunk.done) break;
        buf += decoder.decode(chunk.value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const ev = JSON.parse(line) as PullEvent;
          if (ev.error) throw new PullError(classifyPullError(ev.error), ev.error);
          onProgress(tracker.update(ev, Date.now()));
          if (ev.status === 'success') done = true;
        }
      }
      if (!done) throw new PullError('offline', 'The download ended early');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }
}
