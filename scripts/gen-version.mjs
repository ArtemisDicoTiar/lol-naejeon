#!/usr/bin/env node
// Generates src/version.generated.ts with git hash + commit count + build time.
// Skips on Vercel build servers (no git available there). Vercel uploads the
// locally-generated file instead.

import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT  = resolve(ROOT, 'src/version.generated.ts');

if (process.env.VERCEL) {
  console.log('[gen-version] Running on Vercel — skipping (using uploaded file).');
  process.exit(0);
}

function git(cmd, fallback = 'unknown') {
  try { return execSync(cmd, { cwd: ROOT }).toString().trim(); }
  catch { return fallback; }
}

const hash  = git('git rev-parse --short HEAD');
const count = git('git rev-list --count HEAD', '0');
const time  = new Date().toISOString();

writeFileSync(OUT,
  `// AUTO-GENERATED — do not edit. Regenerated each local build.\n` +
  `export const GIT_HASH  = ${JSON.stringify(hash)};\n` +
  `export const GIT_COUNT = ${JSON.stringify(count)};\n` +
  `export const BUILD_TIME = ${JSON.stringify(time)};\n`,
);

console.log(`[gen-version] v0.0.${count} (${hash}) @ ${time}`);
