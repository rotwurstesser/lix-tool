// Node only: macOS spell check through the Swift shim tools/spellcheck.swift.
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { SpellChecker } from './spell.ts';

const SOURCE = fileURLToPath(new URL('../../tools/spellcheck.swift', import.meta.url));

let binary: Promise<string> | undefined;

// Compiles the shim once per source version into the temp folder.
function compiled(): Promise<string> {
  binary ??= (async () => {
    const hash = createHash('sha1').update(readFileSync(SOURCE)).digest('hex').slice(0, 12);
    const dir = join(tmpdir(), 'lix-tool');
    const out = join(dir, `spellcheck-${hash}`);
    if (!existsSync(out)) {
      mkdirSync(dir, { recursive: true });
      await promisify(execFile)('swiftc', ['-O', SOURCE, '-o', out]);
    }
    return out;
  })();
  binary.catch(() => {
    binary = undefined;
  });
  return binary;
}

export class MacSpellChecker implements SpellChecker {
  async unknown(words: string[]): Promise<Set<string>> {
    const input = words.filter((w) => w.trim()).join('\n');
    if (!input) return new Set();
    const bin = await compiled();
    return new Promise((resolve, reject) => {
      const child = spawn(bin);
      let out = '';
      let err = '';
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (err += d));
      child.on('error', reject);
      child.on('close', (code) => {
        if (code !== 0) reject(new Error(`spellcheck exited with ${code}: ${err.slice(0, 200)}`));
        else resolve(new Set(out.split('\n').filter(Boolean)));
      });
      child.stdin.end(input + '\n');
    });
  }
}
