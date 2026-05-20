#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import yaml from 'js-yaml';

function usage() {
  console.error('Usage: node scripts/merge-mac-update-yml.mjs --out <latest-mac.yml> <latest-mac-arm.yml> <latest-mac-x64.yml>');
}

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
if (outIndex < 0 || !args[outIndex + 1]) {
  usage();
  process.exit(1);
}

const outPath = resolve(args[outIndex + 1]);
const inputPaths = args.filter((arg, index) => index !== outIndex && index !== outIndex + 1);
if (inputPaths.length < 2) {
  usage();
  process.exit(1);
}

const merged = {
  version: null,
  files: [],
  path: null,
  sha512: null,
  releaseDate: null,
};
const seen = new Set();

for (const inputPath of inputPaths.map((item) => resolve(item))) {
  const doc = yaml.load(readFileSync(inputPath, 'utf8'));
  if (!doc || typeof doc !== 'object') {
    throw new Error(`Invalid mac update metadata: ${inputPath}`);
  }
  if (!doc.version) throw new Error(`Missing version in ${inputPath}`);
  if (merged.version && merged.version !== doc.version) {
    throw new Error(`Version mismatch: ${merged.version} !== ${doc.version} in ${inputPath}`);
  }
  merged.version = doc.version;
  merged.releaseDate = merged.releaseDate || doc.releaseDate || new Date().toISOString();

  const files = Array.isArray(doc.files) && doc.files.length > 0
    ? doc.files
    : [{ url: doc.path, sha512: doc.sha512, size: doc.size }];

  for (const file of files) {
    if (!file?.url || !file?.sha512) {
      throw new Error(`Invalid file entry in ${inputPath}: ${JSON.stringify(file)}`);
    }
    if (seen.has(file.url)) continue;
    seen.add(file.url);
    merged.files.push(file);
  }
}

merged.files.sort((a, b) => {
  const aArm = a.url.includes('arm64');
  const bArm = b.url.includes('arm64');
  if (aArm !== bArm) return aArm ? -1 : 1;
  return a.url.localeCompare(b.url);
});

if (!merged.files.some((file) => file.url.includes('arm64'))) {
  throw new Error('Merged mac update metadata is missing an arm64 zip entry');
}
if (!merged.files.some((file) => !file.url.includes('arm64') && file.url.includes('x64'))) {
  throw new Error('Merged mac update metadata is missing an x64 zip entry');
}

merged.path = merged.files[0].url;
merged.sha512 = merged.files[0].sha512;
if (merged.files[0].size) merged.size = merged.files[0].size;

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, yaml.dump(merged, { lineWidth: 120 }), 'utf8');
console.log(`merged ${inputPaths.length} mac update files -> ${outPath}`);
