import { invoke } from '@tauri-apps/api/core';

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
