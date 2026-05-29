#!/usr/bin/env node
// Generates src/version.generated.ts with git hash + commit count + build time.
// The generated file is ignored by git, so CI/Vercel must create it during
// prebuild before TypeScript resolves imports from '@/version.generated'.

import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT  = resolve(ROOT, 'src/version.generated.ts');

function git(cmd, fallback = 'unknown') {
  try { return execSync(cmd, { cwd: ROOT }).toString().trim(); }
  catch { return fallback; }
}

const vercelHash = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7);
const hash  = git('git rev-parse --short HEAD', vercelHash ?? 'unknown');
const count = git('git rev-list --count HEAD', '0');
const time  = new Date().toISOString();

writeFileSync(OUT,
  `// AUTO-GENERATED — do not edit. Regenerated each local build.\n` +
  `export const GIT_HASH  = ${JSON.stringify(hash)};\n` +
  `export const GIT_COUNT = ${JSON.stringify(count)};\n` +
  `export const BUILD_TIME = ${JSON.stringify(time)};\n`,
);

console.log(`[gen-version] v0.0.${count} (${hash}) @ ${time}`);
