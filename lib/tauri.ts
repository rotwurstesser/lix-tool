import { invoke } from '@tauri-apps/api/core';

/** Rejects when `promise` takes longer than `ms`, so no call can hang the UI. */
export function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} took longer than ${Math.round(ms / 1000)} s.`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// True inside the Tauri webview.
export function inTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

// Debug builds only: the topic for an automatic test run, or null.
// Release builds do not have the command, so the call fails and returns null.
export async function debugAutotestTopic(): Promise<string | null> {
  if (!inTauri()) return null;
  try {
    return (await invoke<string | null>('debug_autotest')) ?? null;
  } catch {
    return null;
  }
}

// Debug builds only: prints a line to the app's stdout.
export function debugLog(line: string): void {
  if (inTauri()) invoke('debug_log', { line }).catch(() => {});
}

// Debug builds only: a fixed screen for screenshots (LIX_SCREEN), or null.
export async function debugScreen(): Promise<string | null> {
  if (!inTauri()) return null;
  try {
    return (await invoke<string | null>('debug_screen')) ?? null;
  } catch {
    return null;
  }
}
