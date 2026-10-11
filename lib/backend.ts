import { invoke } from '@tauri-apps/api/core';
import type { SetupStep } from './setup';
import { inTauri } from './tauri';

// Bridge to the Rust backend (src-tauri/src/backend.rs). Outside Tauri (next dev in a
// browser) it uses NEXT_PUBLIC_OLLAMA_URL and keeps settings in localStorage.

export interface BackendStatus {
  state: 'starting' | 'ready' | 'failed';
  message: string;
  url: string | null;
}

export interface Settings {
  keepAlive?: string;
  setupStep?: SetupStep;
}

export const DEFAULT_KEEP_ALIVE = '5m';
const BROWSER_URL = process.env.NEXT_PUBLIC_OLLAMA_URL || 'http://127.0.0.1:11434';
const SETTINGS_KEY = 'lix-settings';

export async function backendStatus(): Promise<BackendStatus> {
  if (!inTauri()) return { state: 'ready', message: 'Ready', url: BROWSER_URL };
  return invoke<BackendStatus>('backend_status');
}

export async function restartBackend(): Promise<void> {
  if (inTauri()) await invoke('backend_restart');
}

// Start (15 s) plus one GPU restart (15 s) plus stopping the old engine fit well inside this.
const START_WAIT_MS = 60_000;

/** Polls until the backend is ready or failed, at most 60 s. */
export async function waitForBackend(timeoutMs = START_WAIT_MS): Promise<BackendStatus> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const status = await backendStatus();
    if (status.state !== 'starting') return status;
    if (Date.now() > deadline) {
      return { state: 'failed', message: 'The writing engine did not start within 60 s.', url: null };
    }
    await new Promise((r) => setTimeout(r, 300));
  }
}

/** Free bytes where the models go, or null when unknown. */
export async function freeDiskBytes(): Promise<number | null> {
  if (!inTauri()) return null;
  try {
    return await invoke<number>('free_disk_bytes', { path: null });
  } catch {
    return null;
  }
}

/** Bytes the models folder takes on disk (partial downloads included); 0 outside Tauri. */
export async function modelsDiskBytes(): Promise<number> {
  if (!inTauri()) return 0;
  try {
    return await invoke<number>('models_disk_bytes');
  } catch {
    return 0;
  }
}

function browserSettings(): Settings {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Settings;
  } catch {
    return {};
  }
}

export async function getSettings(): Promise<Settings> {
  if (!inTauri()) return browserSettings();
  return invoke<Settings>('settings_get');
}

export async function setSettings(patch: Settings): Promise<Settings> {
  if (inTauri()) return invoke<Settings>('settings_set', { patch });
  const all = { ...browserSettings(), ...patch };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(all));
  } catch {
    // Settings then live for this session only.
  }
  return all;
}
