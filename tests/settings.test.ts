import { describe, expect, it } from 'vitest';
import {
  applyTheme,
  DEFAULT_PREFS,
  keepAliveFor,
  memoryFor,
  MEMORY_OPTIONS,
  prefsFromSettings,
  prefsReducer,
  settingsPatch,
  type PrefsAction,
} from '../lib/settings.ts';

describe('keep_alive mapping', () => {
  it('maps each memory option to the keep_alive Ollama gets', () => {
    expect(keepAliveFor('now')).toBe('0');
    expect(keepAliveFor('5m')).toBe('5m');
    expect(keepAliveFor('15m')).toBe('15m');
  });

  it('reads stored values back, unknown ones as 5 min', () => {
    for (const o of MEMORY_OPTIONS) expect(memoryFor(o.keepAlive)).toBe(o.value);
    expect(memoryFor(0)).toBe('now');
    expect(memoryFor('0s')).toBe('now');
    expect(memoryFor(undefined)).toBe('5m');
    expect(memoryFor('42m')).toBe('5m');
  });
});

describe('settings reducer', () => {
  it('defaults: system theme, 5 min, grammar on', () => {
    expect(prefsFromSettings({})).toEqual(DEFAULT_PREFS);
    expect(DEFAULT_PREFS).toEqual({ theme: 'system', memory: '5m', grammarEnabled: true });
  });

  it('loads stored settings and ignores broken values', () => {
    expect(prefsFromSettings({ theme: 'dark', keepAlive: '15m', grammarEnabled: false })).toEqual({
      theme: 'dark',
      memory: '15m',
      grammarEnabled: false,
    });
    expect(prefsReducer(DEFAULT_PREFS, { type: 'loaded', settings: { theme: 'blue' as never } }).theme).toBe('system');
  });

  it('changes one field per action and stores the matching patch', () => {
    const cases: Array<[PrefsAction, object, object]> = [
      [{ type: 'theme', theme: 'light' }, { theme: 'light' }, { theme: 'light' }],
      [{ type: 'memory', memory: 'now' }, { memory: 'now' }, { keepAlive: '0' }],
      [{ type: 'memory', memory: '15m' }, { memory: '15m' }, { keepAlive: '15m' }],
      [{ type: 'grammarEnabled', on: false }, { grammarEnabled: false }, { grammarEnabled: false }],
    ];
    for (const [action, change, patch] of cases) {
      expect(prefsReducer(DEFAULT_PREFS, action)).toEqual({ ...DEFAULT_PREFS, ...change });
      expect(settingsPatch(action)).toEqual(patch);
    }
    expect(settingsPatch({ type: 'loaded', settings: {} })).toBeNull();
  });

  it('a stored patch loads back to the same prefs', () => {
    let prefs = DEFAULT_PREFS;
    let stored = {};
    for (const action of [
      { type: 'theme', theme: 'dark' },
      { type: 'memory', memory: 'now' },
      { type: 'grammarEnabled', on: false },
    ] as PrefsAction[]) {
      prefs = prefsReducer(prefs, action);
      stored = { ...stored, ...settingsPatch(action) };
    }
    expect(prefsFromSettings(stored)).toEqual(prefs);
  });
});

describe('applyTheme', () => {
  it('sets data-theme for light and dark, removes it for system', () => {
    const attrs = new Map<string, string>();
    const root = { setAttribute: (n: string, v: string) => attrs.set(n, v), removeAttribute: (n: string) => attrs.delete(n) };
    applyTheme('dark', root);
    expect(attrs.get('data-theme')).toBe('dark');
    applyTheme('light', root);
    expect(attrs.get('data-theme')).toBe('light');
    applyTheme('system', root);
    expect(attrs.has('data-theme')).toBe(false);
  });
});
