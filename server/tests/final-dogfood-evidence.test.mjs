// @platform all
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

function readRepoFile(path) {
  return readFileSync(join(ROOT, path), 'utf-8');
}

test('final dogfood evidence capture is redacted and manually explicit', () => {
  const source = readRepoFile('scripts/final-dogfood-check.mjs');
  const docs = readRepoFile('docs/FINAL_DOGFOOD_EVIDENCE.md');
  const runbook = readRepoFile('docs/PACKAGED_ELECTRON_DOGFOOD.md');
  const pkg = readRepoFile('package.json');

  assert.match(source, /schema: 'hydra\.final-dogfood-evidence\.v1'/);
  assert.match(source, /--write-evidence/);
  assert.match(source, /--version=/);
  assert.match(source, /--artifact-dir=/);
  assert.match(source, /--app=/);
  assert.match(source, /--manual=/);
  assert.match(source, /const manualCheckIds = new Set\(manualChecks\.map\(\(item\) => item\.id\)\)/);
  assert.match(source, /const unknownManualIds = \[\.\.\.manualVerified\]\.filter\(\(id\) => !manualCheckIds\.has\(id\)\)/);
  assert.match(source, /Unknown manual check id\(s\)/);
  assert.match(source, /manualVerified\.has\(item\.id\)/);
  assert.match(source, /evidence\.checks\.launchDiagnostics = \[/);
  assert.match(source, /detail: detail\.slice\(0, 4000\)/);
  assert.match(source, /not API keys, cookies, account emails, Clerk session IDs, screenshots, or local database contents/);
  assert.match(source, /packagedAppPath/);
  assert.match(source, /artifactDir/);
  assert.match(source, /const allArtifactsPresent = evidence\.checks\.artifacts\.every\(\(item\) => item\.ok\)/);
  assert.match(source, /missingAndBlockersOk: report\.summary\.missing === 0 && report\.summary\.blockers === 0/);
  assert.match(source, /evidence\.checks\.packagedApp\?\.ok/);
  assert.match(source, /evidence\.checks\.unknownManualIds\.length === 0/);
  assert.match(source, /unknown --manual id was passed/);
  assert.match(source, /audit has missing\/blocker evidence/);
  assert.ok(source.includes('isAbsolute(evidencePath) ? evidencePath : join(ROOT, evidencePath)'));
  assert.ok(source.includes('writeFileSync(outputPath'));
  assert.ok(source.includes('{ mode: 0o600 }'));
  assert.doesNotMatch(source, /readFileSync\([^)]*hydra\.db/);
  assert.doesNotMatch(source, /Cookies-journal|local-secrets|jwt-secret/);

  assert.match(docs, /DOGFOOD_EVIDENCE\.json/);
  assert.match(docs, /--version=<version>/);
  assert.match(docs, /--artifact-dir=<dir>/);
  assert.match(docs, /--app=<path\/to\/Hydra\.app>/);
  assert.match(docs, /--launch-diagnostics/);
  assert.match(docs, /LaunchServices/);
  assert.match(docs, /--manual=packaged-gui-launch/);
  assert.match(docs, /Do not paste API keys/);
  assert.match(docs, /not release-complete/);
  assert.match(runbook, /--version=<version>/);
  assert.match(runbook, /--artifact-dir=\/path\/to\/downloaded\/release-assets/);
  assert.match(runbook, /--app=\/path\/to\/extracted\/Hydra\.app/);
  assert.match(pkg, /"dogfood:final": "node scripts\/final-dogfood-check\.mjs"/);
});
