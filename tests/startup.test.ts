import { describe, expect, it } from 'vitest';
import type { BackendStatus } from '../lib/backend.ts';
import { restartPhase, startupPhase, type StartupDeps } from '../lib/startup.ts';

const ready: BackendStatus = { state: 'ready', message: 'Ready', url: 'http://127.0.0.1:11535' };

function deps(over: Partial<StartupDeps> = {}): StartupDeps {
  return {
    waitForBackend: async () => ready,
    getSettings: async () => ({}),
    isInstalled: async () => true,
    restartBackend: async () => {},
    ...over,
  };
}

describe('startupPhase', () => {
  it('goes to the generator with the saved keep_alive', async () => {
    const phase = await startupPhase(deps({ getSettings: async () => ({ setupStep: 'done', keepAlive: '15m' }) }));
    expect(phase).toEqual({ kind: 'generator', url: ready.url, keepAlive: '15m' });
  });

  it('shows setup while the model is missing', async () => {
    const phase = await startupPhase(deps({ isInstalled: async () => false }));
    expect(phase).toEqual({ kind: 'setup', url: ready.url, step: 'welcome' });
  });

  it('shows the Ready screen when finishing was not saved', async () => {
    const phase = await startupPhase(deps({ getSettings: async () => ({ setupStep: 'ready' }) }));
    expect(phase).toMatchObject({ kind: 'setup', step: 'ready' });
  });

  it('passes a failed engine through', async () => {
    const phase = await startupPhase(deps({ waitForBackend: async () => ({ state: 'failed', message: 'missing', url: null }) }));
    expect(phase).toEqual({ kind: 'failed', message: 'missing' });
  });

  it('turns a rejected status call into a failed phase instead of hanging', async () => {
    const phase = await startupPhase(
      deps({
        waitForBackend: async () => {
          throw new Error('IPC down');
        },
      }),
    );
    expect(phase).toEqual({ kind: 'failed', message: 'IPC down' });
  });

  it('turns a rejected settings or tags call into a failed phase', async () => {
    const phase = await startupPhase(deps({ getSettings: () => Promise.reject('no settings') }));
    expect(phase).toEqual({ kind: 'failed', message: 'no settings' });
  });
});

describe('restartPhase', () => {
  it('reports a rejected restart', async () => {
    const phase = await restartPhase(
      deps({
        restartBackend: async () => {
          throw new Error('restart failed');
        },
      }),
    );
    expect(phase).toEqual({ kind: 'failed', message: 'restart failed' });
  });

  it('resolves the phase again after a restart', async () => {
    let restarted = false;
    const phase = await restartPhase(
      deps({
        restartBackend: async () => {
          restarted = true;
        },
      }),
    );
    expect(restarted).toBe(true);
    expect(phase.kind).toBe('generator');
  });
});
