import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { HttpLanguageTool, LanguageToolChecker, LT_LANGUAGE, type LtMatch, type LtTransport } from './generate/languagetool';
import { inTauri, withTimeout } from './tauri';

// Bridge to the optional grammar checker (src-tauri/src/grammar.rs). Outside Tauri (next dev in a
// browser) LanguageTool is used only when NEXT_PUBLIC_LT_URL points at a running server.

export interface GrammarProgress {
  step: 'download' | 'verify' | 'unpack';
  item: string;
  done: number;
  total: number;
}

export interface GrammarStatus {
  install: 'missing' | 'installing' | 'installed' | 'failed';
  message: string;
  progress: GrammarProgress | null;
  downloadBytes: number;
  running: boolean;
  port: number | null;
}

const BROWSER_LT = process.env.NEXT_PUBLIC_LT_URL || '';
const MISSING: GrammarStatus = { install: 'missing', message: '', progress: null, downloadBytes: 300_000_000, running: false, port: null };

export async function grammarStatus(): Promise<GrammarStatus> {
  if (!inTauri()) return BROWSER_LT ? { ...MISSING, install: 'installed' } : MISSING;
  return withTimeout(invoke<GrammarStatus>('grammar_status'), 5_000, 'Grammar checker status');
}

/** Starts the download; follow it with onGrammarStatus. */
export async function installGrammar(): Promise<GrammarStatus> {
  if (!inTauri()) return MISSING;
  return withTimeout(invoke<GrammarStatus>('grammar_install'), 10_000, 'Starting the download');
}

export async function cancelGrammarInstall(): Promise<void> {
  if (inTauri()) await invoke('grammar_cancel');
}

/** Stops LanguageTool and deletes its files. */
export async function removeGrammar(): Promise<GrammarStatus> {
  if (!inTauri()) return MISSING;
  // Rust waits up to 10 s for LanguageTool to stop, then deletes the files.
  return withTimeout(invoke<GrammarStatus>('grammar_remove'), 30_000, 'Removing LanguageTool');
}

export async function grammarDiskBytes(): Promise<number> {
  if (!inTauri()) return 0;
  return withTimeout(invoke<number>('grammar_disk_bytes'), 10_000, 'Disk use').catch(() => 0);
}

/** Calls `cb` on every install status change. Returns the unsubscribe function. */
export async function onGrammarStatus(cb: (s: GrammarStatus) => void): Promise<() => void> {
  if (!inTauri()) return () => {};
  return listen<GrammarStatus>('grammar-status', (e) => cb(e.payload));
}

/** Checks through Rust, which starts LanguageTool on demand. */
class TauriLanguageTool implements LtTransport {
  async check(text: string, signal?: AbortSignal): Promise<LtMatch[]> {
    signal?.throwIfAborted();
    // Rust limits the start (60 s) and the check (60 s); this outer limit only guards the bridge.
    const reply = await withTimeout(
      invoke<{ matches: LtMatch[] }>('grammar_check', { text, language: LT_LANGUAGE }),
      150_000,
      'Grammar check',
    );
    signal?.throwIfAborted();
    return reply.matches;
  }
}

/** The loop's grammar checker when LanguageTool is installed and on, else undefined (model check). */
export async function grammarChecker(enabled = true): Promise<LanguageToolChecker | undefined> {
  if (!enabled) return undefined;
  const status = await grammarStatus().catch(() => MISSING);
  if (status.install !== 'installed') return undefined;
  // Start the JVM now, while the model writes the draft. A start error shows up at the first check.
  if (inTauri()) invoke('grammar_ensure_running').catch(() => {});
  return new LanguageToolChecker(inTauri() ? new TauriLanguageTool() : new HttpLanguageTool(BROWSER_LT));
}

export function formatGrammarProgress(s: GrammarStatus): string {
  const p = s.progress;
  if (!p) return s.message;
  if (p.step !== 'download' || !p.total) return s.message;
  return `Downloading ${p.item}, ${(p.done / 1e6).toFixed(0)} of ${(p.total / 1e6).toFixed(0)} MB`;
}

export function grammarPercent(s: GrammarStatus): number {
  const p = s.progress;
  return p && p.step === 'download' && p.total ? Math.min(100, (100 * p.done) / p.total) : 0;
}
