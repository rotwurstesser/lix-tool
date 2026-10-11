import { invoke } from '@tauri-apps/api/core';
import { inTauri } from '../tauri.ts';
import { NoopSpellChecker, type SpellChecker } from './spell.ts';

// macOS NSSpellChecker through the Rust command spell_unknown (src-tauri/src/spell.rs).
export class TauriSpellChecker implements SpellChecker {
  async unknown(words: string[]): Promise<Set<string>> {
    const list = words.filter((w) => w.trim());
    if (!list.length) return new Set();
    return new Set(await invoke<string[]>('spell_unknown', { words: list }));
  }
}

// Browser spell checker: the Tauri one in the app, else none.
export function browserSpellChecker(): SpellChecker {
  return inTauri() ? new TauriSpellChecker() : new NoopSpellChecker();
}
