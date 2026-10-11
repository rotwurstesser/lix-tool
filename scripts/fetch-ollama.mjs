#!/usr/bin/env node
// Puts the Ollama release into src-tauri/resources/ollama for the app bundle.
// Verifies the sha256 of the release tarball. Skips when the right version is already there.
// Local cache: set LIX_OLLAMA_TGZ=<path to ollama-darwin.tgz> to skip the download.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const VERSION = 'v0.40.0';
const SHA256 = 'b490b4925a95c5f3dfcd889e566cf3dcd727848d59057fb00b03f1d6630326dc';
const URL = `https://github.com/ollama/ollama/releases/download/${VERSION}/ollama-darwin.tgz`;

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dest = join(root, 'src-tauri/resources/ollama');
const work = join(root, 'src-tauri/target/ollama-fetch');
const marker = join(dest, '.version');

async function sha256(file) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

async function download(file) {
  console.log(`Downloading ${URL}`);
  const res = await fetch(URL);
  if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(file));
}

// True when a Mach-O file has no arm64 slice (x86-only CPU backends).
function x86Only(file) {
  try {
    return !execFileSync('/usr/bin/lipo', ['-archs', file], { encoding: 'utf8' }).includes('arm64');
  } catch {
    return false;
  }
}

async function main() {
  if (existsSync(marker) && (await readFile(marker, 'utf8')).trim() === VERSION && existsSync(join(dest, 'ollama'))) {
    console.log(`Ollama ${VERSION} already in ${dest}`);
    return;
  }
  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });

  let tgz = process.env.LIX_OLLAMA_TGZ || '';
  if (!tgz) {
    tgz = join(work, 'ollama-darwin.tgz');
    await download(tgz);
  }
  const got = await sha256(tgz);
  if (got !== SHA256) throw new Error(`sha256 mismatch for ${tgz}: ${got}`);
  console.log(`sha256 ok (${tgz})`);

  const staging = join(work, 'ollama');
  await mkdir(staging);
  execFileSync('/usr/bin/tar', ['-xzf', tgz, '-C', staging, '--exclude', '._*']);

  for (const name of await readdir(staging)) {
    const file = join(staging, name);
    const drop = name.startsWith('._') || name === '.DS_Store' || (name.endsWith('.so') && x86Only(file));
    if (drop) await rm(file, { recursive: true, force: true });
  }
  if (!(await stat(join(staging, 'ollama'))).isFile()) throw new Error('ollama binary missing in tarball');
  await writeFile(join(staging, '.version'), VERSION + '\n');

  await rm(dest, { recursive: true, force: true });
  await mkdir(dirname(dest), { recursive: true });
  try {
    await rename(staging, dest);
  } catch {
    await cp(staging, dest, { recursive: true, verbatimSymlinks: true });
  }
  await rm(work, { recursive: true, force: true });
  console.log(`Ollama ${VERSION} ready in ${dest}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
