import { describe, expect, it } from 'vitest';
import { MacSpellChecker } from '../lib/generate/spell-node.ts';

describe.skipIf(process.platform !== 'darwin')('tools/spellcheck.swift', () => {
  it('flags invented words and accepts real ones', { timeout: 120_000 }, async () => {
    const bad = await new MacSpellChecker().unknown(['Wärmestraung', 'Zauberbüchern', 'grossen']);
    expect([...bad]).toEqual(['Wärmestraung']);
  });

  // NSSpellChecker accepts this compound in every German variant (checked 2026-10-11).
  // LanguageTool catches it (see the grammar check), the spell checker alone cannot.
  it.todo('flags "wohlwärmer"');
});
