import type { Settings } from './backend';

// User preferences from the settings panel, and how they map to settings.json and Ollama.

export type Theme = 'system' | 'light' | 'dark';
export type Memory = 'now' | '5m' | '15m';

export interface Prefs {
  theme: Theme;
  memory: Memory;
  grammarEnabled: boolean;
}

export const DEFAULT_PREFS: Prefs = { theme: 'system', memory: '5m', grammarEnabled: true };

export const THEME_OPTIONS: ReadonlyArray<{ value: Theme; label: string }> = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

// keep_alive goes to every Ollama request ("0" means: unload when the text is done, see app/page.tsx); LanguageTool stops after the same idle time (at least 30 s).
export const MEMORY_OPTIONS: ReadonlyArray<{ value: Memory; label: string; keepAlive: string }> = [
  { value: 'now', label: 'Immediately', keepAlive: '0' },
  { value: '5m', label: 'After 5 min', keepAlive: '5m' },
  { value: '15m', label: 'After 15 min', keepAlive: '15m' },
];

export function keepAliveFor(memory: Memory): string {
  return MEMORY_OPTIONS.find((o) => o.value === memory)?.keepAlive ?? '5m';
}

/** Memory option for a stored keep_alive. Unknown values fall back to 5 min. */
export function memoryFor(keepAlive: unknown): Memory {
  if (keepAlive === '0' || keepAlive === 0 || keepAlive === '0s' || keepAlive === '0m') return 'now';
  return MEMORY_OPTIONS.find((o) => o.keepAlive === keepAlive)?.value ?? '5m';
}

export function isTheme(value: unknown): value is Theme {
  return value === 'system' || value === 'light' || value === 'dark';
}

export function prefsFromSettings(s: Settings): Prefs {
  return {
    theme: isTheme(s.theme) ? s.theme : DEFAULT_PREFS.theme,
    memory: memoryFor(s.keepAlive),
    grammarEnabled: s.grammarEnabled !== false,
  };
}

export type PrefsAction =
  | { type: 'loaded'; settings: Settings }
  | { type: 'theme'; theme: Theme }
  | { type: 'memory'; memory: Memory }
  | { type: 'grammarEnabled'; on: boolean };

export function prefsReducer(state: Prefs, action: PrefsAction): Prefs {
  switch (action.type) {
    case 'loaded':
      return prefsFromSettings(action.settings);
    case 'theme':
      return { ...state, theme: action.theme };
    case 'memory':
      return { ...state, memory: action.memory };
    case 'grammarEnabled':
      return { ...state, grammarEnabled: action.on };
  }
}

/** The settings.json patch for a user change; null for actions that store nothing. */
export function settingsPatch(action: PrefsAction): Settings | null {
  switch (action.type) {
    case 'loaded':
      return null;
    case 'theme':
      return { theme: action.theme };
    case 'memory':
      return { keepAlive: keepAliveFor(action.memory) };
    case 'grammarEnabled':
      return { grammarEnabled: action.on };
  }
}

/** Sets data-theme on <html>: no attribute means "follow the system". */
export function applyTheme(theme: Theme, root: { setAttribute(n: string, v: string): void; removeAttribute(n: string): void }): void {
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}
