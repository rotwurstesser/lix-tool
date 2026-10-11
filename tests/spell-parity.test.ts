import { describe, expect, it } from 'vitest';
import parity from './spell-parity.json';
import { MacSpellChecker } from '../lib/generate/spell-node.ts';

// The Rust test src-tauri/tests/spell_parity.rs checks spell.rs against the same list.
describe.skipIf(process.platform !== 'darwin')('spell parity list (Swift shim)', () => {
  it('finds exactly the listed unknown words', { timeout: 120_000 }, async () => {
    const bad = await new MacSpellChecker().unknown(parity.words);
    expect(parity.words.filter((w) => bad.has(w))).toEqual(parity.unknown);
  });
});
