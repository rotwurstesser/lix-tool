export interface GenerateOptions {
  signal?: AbortSignal;
}

export interface LlmClient {
  generate(prompt: string, opts?: GenerateOptions): Promise<string>;
}

export const CALL_TIMEOUT_MS = 120_000;

// Combines the caller's abort signal with a per-call timeout.
function callSignal(caller: AbortSignal | undefined, timeoutMs: number) {
  const ctrl = new AbortController();
  const timer = setTimeout(
    () => ctrl.abort(new DOMException(`Model call timed out after ${timeoutMs / 1000} s`, 'TimeoutError')),
    timeoutMs,
  );
  const onAbort = () => ctrl.abort(caller?.reason);
  if (caller?.aborted) onAbort();
  else caller?.addEventListener('abort', onAbort, { once: true });
  const done = () => {
    clearTimeout(timer);
    caller?.removeEventListener('abort', onAbort);
  };
  return { signal: ctrl.signal, done };
}

export class OllamaClient implements LlmClient {
  readonly baseUrl: string;
  readonly model: string;
  readonly keepAlive: string | number;
  readonly timeoutMs: number;
  private think?: Promise<boolean | string | undefined>;

  constructor(baseUrl: string, model: string, keepAlive: string | number = '5m', timeoutMs = CALL_TIMEOUT_MS) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.model = model;
    this.keepAlive = keepAlive;
    this.timeoutMs = timeoutMs;
  }

  private async post(path: string, body: unknown, caller?: AbortSignal): Promise<Record<string, unknown>> {
    const { signal, done } = callSignal(caller, this.timeoutMs);
    try {
      const res = await fetch(this.baseUrl + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
      if (!res.ok) throw new Error(`Ollama ${path} failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
      return (await res.json()) as Record<string, unknown>;
    } catch (err) {
      // Report a timeout as such, not as a plain abort.
      if (signal.aborted && signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError') {
        throw signal.reason;
      }
      throw err;
    } finally {
      done();
    }
  }

  // gpt-oss needs a think level. Other thinking models get thinking off: it is slow and uses up the token budget.
  private thinkSetting(signal?: AbortSignal): Promise<boolean | string | undefined> {
    this.think ??= this.post('/api/show', { model: this.model }, signal).then((info) => {
      const caps = Array.isArray(info.capabilities) ? info.capabilities : [];
      if (!caps.includes('thinking')) return undefined;
      return this.model.includes('gpt-oss') ? 'low' : false;
    });
    this.think.catch(() => {
      this.think = undefined;
    });
    return this.think;
  }

  async generate(prompt: string, opts: GenerateOptions = {}): Promise<string> {
    const think = await this.thinkSetting(opts.signal);
    const body: Record<string, unknown> = {
      model: this.model,
      prompt,
      stream: false,
      keep_alive: this.keepAlive,
      options: { temperature: 0.8, num_predict: 3000, num_ctx: 4096 },
    };
    if (think !== undefined) body.think = think;
    const data = await this.post('/api/generate', body, opts.signal);
    return typeof data.response === 'string' ? data.response.trim() : '';
  }

  // Frees the model memory now.
  async unload(): Promise<void> {
    await this.post('/api/generate', { model: this.model, keep_alive: 0 });
  }
}
