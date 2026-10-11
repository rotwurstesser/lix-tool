import type { BackendStatus, Settings } from './backend';
import { DEFAULT_KEEP_ALIVE } from './backend';
import { initialStep, type SetupStep } from './setup';

// What the app shows after start: engine state first, then setup or generator.

export type Phase =
  | { kind: 'starting' }
  | { kind: 'failed'; message: string }
  | { kind: 'setup'; url: string; step: SetupStep }
  | { kind: 'generator'; url: string; keepAlive: string };

export interface StartupDeps {
  waitForBackend: () => Promise<BackendStatus>;
  getSettings: () => Promise<Settings>;
  isInstalled: (url: string) => Promise<boolean>;
  restartBackend?: () => Promise<void>;
}

function failed(err: unknown): Phase {
  return { kind: 'failed', message: err instanceof Error ? err.message : String(err) };
}

/** Never rejects: any error becomes a "failed" phase with a retry. */
export async function startupPhase(deps: StartupDeps): Promise<Phase> {
  try {
    const status = await deps.waitForBackend();
    if (status.state !== 'ready' || !status.url) return { kind: 'failed', message: status.message };
    const [settings, installed] = await Promise.all([deps.getSettings(), deps.isInstalled(status.url)]);
    const step = initialStep(settings.setupStep, installed);
    return step === 'done'
      ? { kind: 'generator', url: status.url, keepAlive: settings.keepAlive ?? DEFAULT_KEEP_ALIVE }
      : { kind: 'setup', url: status.url, step };
  } catch (err) {
    return failed(err);
  }
}

/** Restarts the engine, then resolves the phase again. Never rejects. */
export async function restartPhase(deps: StartupDeps): Promise<Phase> {
  try {
    await deps.restartBackend?.();
  } catch (err) {
    return failed(err);
  }
  return startupPhase(deps);
}
