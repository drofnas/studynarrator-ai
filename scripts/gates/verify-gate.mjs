#!/usr/bin/env node

import { mkdirSync, readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const gate = process.argv[2];
const repositoryRoot = resolve(import.meta.dirname, "../..");
const supportedGates = new Set(["G01", "G02", "G03", "G04"]);

function fail(message) {
  process.stderr.write(`GATE ${gate ?? "UNKNOWN"}: ERROR: ${message}\n`);
  process.exit(1);
}

function run(command, args, environment = {}) {
  process.stdout.write(`\n> ${command} ${args.join(" ")}\n`);
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env: { ...process.env, ...environment },
    stdio: "inherit",
    shell: false
  });
  if (result.error) fail(`${command} could not start`);
  if (result.status !== 0) fail(`${command} ${args.join(" ")} failed with exit ${String(result.status)}`);
}

function requireApprovedGate(approvedGate) {
  run("git", ["merge-base", "--is-ancestor", `gate-${approvedGate}-approved`, "HEAD"]);
  const approval = readFileSync(resolve(repositoryRoot, `docs/gates/approvals/${approvedGate}.md`), "utf8");
  if (!/^APPROVED$/mu.test(approval)) fail(`${approvedGate} approval record is missing an APPROVED decision`);
}

if (!gate || !supportedGates.has(gate) || process.argv.length !== 3) {
  fail("usage: npm run verify:gate -- G01|G02|G03|G04");
}

requireApprovedGate("G00");
if (gate === "G02" || gate === "G03" || gate === "G04") requireApprovedGate("G01");
if (gate === "G03" || gate === "G04") requireApprovedGate("G02");
if (gate === "G04") requireApprovedGate("G03");

run("node", ["-e", `
  const fs = require('node:fs');
  const fixture = fs.readFileSync('fixtures/baseline/speaches-smoke.txt', 'utf8').trim();
  if (fixture !== 'This is the StudyNarrator baseline. SQL indexes can speed up database reads.') process.exit(1);
`]);
run("bash", ["-n", "scripts/gates/g00-speaches-baseline.sh"]);
run("bash", ["-n", "scripts/gates/g00-reset.sh"]);

if (gate === "G02") {
  run("node", ["-e", `
    const fs = require('node:fs');
    const plan = fs.readFileSync('docs/gated-implementation-plan-v1.md', 'utf8');
    if (!plan.includes('- [x] G02 —')) process.exit(1);
    for (const path of [
      'docs/script-grammar-v1.md',
      'fixtures/gates/study-guide-valid.txt',
      'fixtures/gates/study-guide-invalid.txt',
      'fixtures/gates/expected/study-guide-valid.parse.json',
      'fixtures/gates/expected/study-guide-invalid.parse.json',
      'docs/gates/G02-manual-test.md'
    ]) if (!fs.existsSync(path)) process.exit(1);
    const server = fs.readFileSync('apps/server/src/app.ts', 'utf8');
    const desktop = fs.readFileSync('apps/desktop/src/ipc.ts', 'utf8');
    if ((server.includes('/api/projects/') && server.includes('/parse')) || desktop.includes('scripts.parse')) process.exit(1);
  `]);
}

if (gate === "G03") {
  run("node", ["-e", `
    const fs = require('node:fs');
    const plan = fs.readFileSync('docs/gated-implementation-plan-v1.md', 'utf8');
    if (!plan.includes('- [x] G02 —') || !plan.includes('- [ ] G03 —')) process.exit(1);
    for (const path of [
      'packages/core/src/transformer.ts',
      'packages/core/src/transformer.test.ts',
      'packages/core/src/lexicon.ts',
      'packages/core/src/lexicon.test.ts',
      'packages/core/src/pacing.ts',
      'packages/core/src/pacing.test.ts',
      'fixtures/gates/expected/study-guide-valid.transform.json',
      'apps/web/src/features/script-lab/components/LexiconEditor.tsx',
      'apps/web/src/features/script-lab/components/TransformDiagnostics.tsx',
      'apps/web/src/features/script-lab/components/IgnoredDiagnostics.tsx',
      'apps/web/src/features/script-lab/components/ScriptEditor.tsx',
      'apps/web/src/features/script-lab/components/TransitionSettings.tsx',
      'apps/web/src/features/script-lab/components/PacingPreview.tsx',
      'apps/web/src/features/script-lab/components/TranscriptTabs.tsx',
      'docs/gates/G03-manual-test.md'
    ]) if (!fs.existsSync(path)) process.exit(1);
    const coreIndex = fs.readFileSync('packages/core/src/index.ts', 'utf8');
    const schemas = fs.readFileSync('packages/core/src/schemas.ts', 'utf8');
    const parser = fs.readFileSync('packages/core/src/parser.ts', 'utf8');
    const transformer = fs.readFileSync('packages/core/src/transformer.ts', 'utf8');
    const pacing = fs.readFileSync('packages/core/src/pacing.ts', 'utf8');
    const lexiconEditor = fs.readFileSync('apps/web/src/features/script-lab/components/LexiconEditor.tsx', 'utf8');
    const transformDiagnostics = fs.readFileSync('apps/web/src/features/script-lab/components/TransformDiagnostics.tsx', 'utf8');
    const ignoredDiagnostics = fs.readFileSync('apps/web/src/features/script-lab/components/IgnoredDiagnostics.tsx', 'utf8');
    const scriptEditor = fs.readFileSync('apps/web/src/features/script-lab/components/ScriptEditor.tsx', 'utf8');
    const transitionSettings = fs.readFileSync('apps/web/src/features/script-lab/components/TransitionSettings.tsx', 'utf8');
    const pacingPreview = fs.readFileSync('apps/web/src/features/script-lab/components/PacingPreview.tsx', 'utf8');
    const workerProtocol = fs.readFileSync('apps/web/src/workers/parser/parserWorkerProtocol.ts', 'utf8');
    const manualTest = fs.readFileSync('docs/gates/G03-manual-test.md', 'utf8');
    if (
      !coreIndex.includes('transformer.js')
      || !coreIndex.includes('lexicon.js')
      || !coreIndex.includes('LexiconEntryAuthoringCollectionSchema')
      || !schemas.includes('ignorePattern: z.string().min(1)')
      || !schemas.includes('ignoredDiagnostics: z.array(IgnoredDiagnosticSchema).optional()')
      || !schemas.includes('SYSTEM_DEFAULT_SPEAKER_ID = "narrator"')
      || !schemas.includes('DEFAULT_PARAGRAPH_PAUSE_ID = "pause_medium"')
      || !schemas.includes('DEFAULT_PARAGRAPH_PAUSE_DURATION_MS = 750')
      || !schemas.includes('durationMs: z.number().int().min(0).max(30_000)')
      || !parser.includes('defaultSpeakerId ?? SYSTEM_DEFAULT_SPEAKER_ID')
      || parser.includes('MISSING_DEFAULT_SPEAKER')
      || !transformer.includes('export function transformScript')
      || !transformer.includes('readableReplacement: projected.annotation.rawText')
      || !transformer.includes('ttsReplacement: projected.annotation.rawText')
      || !pacing.includes('export function resolveParagraphPauses')
      || !pacing.includes('suppressedByExplicitPause')
      || !lexiconEditor.includes('Edit as JSON')
      || !lexiconEditor.includes('Save JSON')
      || !transformDiagnostics.includes('Ignore this pattern')
      || !ignoredDiagnostics.includes('Ignored diagnostic patterns')
      || !scriptEditor.includes('System Default')
      || !scriptEditor.includes('SYSTEM_DEFAULT_SPEAKER_ID')
      || !transitionSettings.includes('Pause at paragraph breaks')
      || !transitionSettings.includes('DEFAULT_PARAGRAPH_PAUSE_DURATION_MS')
      || !pacingPreview.includes('Paragraph pacing preview')
      || !pacingPreview.includes('Suppressed by explicit pause')
      || !workerProtocol.includes('resolveParagraphPauses')
      || !workerProtocol.includes('ignoredDiagnostics: input.ignoredDiagnostics')
      || !manualTest.includes('non-blocking')
      || !manualTest.includes('{{resume|cv}}')
      || !manualTest.includes('Automatic paragraph pacing')
      || !manualTest.includes('pause_medium')
    ) process.exit(1);
    const forbidden = new RegExp('fetch\\\\s*\\\\(|localStorage|indexedDB|/api/|speaches|system\\\\.[A-Za-z]', 'iu');
    for (const path of [
      'packages/core/src/transformer.ts',
      'packages/core/src/pacing.ts',
      'apps/web/src/features/script-lab/useScriptLab.ts',
      'apps/web/src/workers/parser/parserWorkerProtocol.ts'
    ]) if (forbidden.test(fs.readFileSync(path, 'utf8'))) process.exit(1);
  `]);
}

if (gate === "G04") {
  run("node", ["-e", `
    const fs = require('node:fs');
    const plan = fs.readFileSync('docs/gated-implementation-plan-v1.md', 'utf8');
    if (!plan.includes('- [x] G03 —') || !plan.includes('- [ ] G04 —')) process.exit(1);
    for (const path of [
      'packages/shared-types/src/persistence.ts',
      'packages/persistence/src/migrations.ts',
      'packages/persistence/src/repository.ts',
      'packages/application/src/persistence.ts',
      'apps/server/src/migrate.ts',
      'apps/web/src/services/persistence/persistenceClient.ts',
      'apps/web/src/pages/persistence-lab/PersistenceLabPage.tsx',
      'fixtures/gates/G04/schema-v1.sql',
      'docs/gates/G04-manual-test.md'
    ]) if (!fs.existsSync(path)) process.exit(1);
    const schemas = fs.readFileSync('packages/shared-types/src/persistence.ts', 'utf8');
    const migrations = fs.readFileSync('packages/persistence/src/migrations.ts', 'utf8');
    const repository = fs.readFileSync('packages/persistence/src/repository.ts', 'utf8');
    const app = fs.readFileSync('apps/server/src/app.ts', 'utf8');
    const ipc = fs.readFileSync('apps/desktop/src/ipc.ts', 'utf8');
    const lab = fs.readFileSync('apps/web/src/pages/persistence-lab/PersistenceLabPage.tsx', 'utf8');
    const scriptLab = fs.readFileSync('apps/web/src/features/script-lab/useScriptLab.ts', 'utf8');
    const manual = fs.readFileSync('docs/gates/G04-manual-test.md', 'utf8');
    if (
      !schemas.includes('DATABASE_SCHEMA_VERSION = 2')
      || !schemas.includes('PERSISTENCE_CHANNELS')
      || !schemas.includes('projects.list')
      || !schemas.includes('connection-profiles.delete')
      || !migrations.includes('schema_migrations')
      || !migrations.includes('database.backup')
      || !migrations.includes('BEGIN IMMEDIATE')
      || !repository.includes('createProject')
      || !repository.includes('replaceProject')
      || !repository.includes('scriptHash')
      || !app.includes('/api/persistence/status')
      || !app.includes('/api/projects')
      || !ipc.includes('registerPersistenceHandlers')
      || ipc.includes('persistence.execute')
      || !lab.includes('Migration ledger')
      || !lab.includes('Reload from database')
      || !lab.includes('Connection placeholders')
      || !manual.includes('two full restarts')
      || !manual.includes('zero Speaches')
    ) process.exit(1);
    const forbiddenSecrets = /apiKey|api_key|password|authorization|bearerToken/iu;
    for (const path of [
      'packages/shared-types/src/persistence.ts',
      'packages/persistence/src/repository.ts',
      'apps/web/src/pages/persistence-lab/PersistenceLabPage.tsx'
    ]) if (forbiddenSecrets.test(fs.readFileSync(path, 'utf8'))) process.exit(1);
    const forbiddenScriptLab = new RegExp('localStorage|indexedDB|fetch\\\\s*\\\\(|/api/', 'u');
    if (forbiddenScriptLab.test(scriptLab)) process.exit(1);
  `]);
  run("npm", ["run", "db:migrate", "--", "--data-dir", ".tmp/gates/G04/verify-cli"]);
}

run("npm", ["run", "lint"]);
run("npm", ["run", "typecheck"]);
run("npm", ["test"]);
run("npm", ["run", "build"]);

const gateData = resolve(repositoryRoot, `.tmp/gates/${gate}`);
const nodeData = resolve(gateData, "verify-node");
const electronData = resolve(gateData, "verify-electron");
mkdirSync(nodeData, { recursive: true, mode: 0o700 });
mkdirSync(electronData, { recursive: true, mode: 0o700 });

const serverNativeModule = realpathSync(resolve(repositoryRoot, "apps/server/node_modules/better-sqlite3"));
const desktopNativeModule = realpathSync(resolve(repositoryRoot, "apps/desktop/node_modules/better-sqlite3"));
if (serverNativeModule === desktopNativeModule) fail("server and Electron must not share a better-sqlite3 installation");

run("npm", ["run", "smoke", "--workspace", "@studynarrator/server"], { STUDYNARRATOR_DATA_DIR: nodeData });
run("npm", ["run", "rebuild:native", "--workspace", "@studynarrator/desktop"]);
run("npm", ["run", "smoke", "--workspace", "@studynarrator/desktop"], { STUDYNARRATOR_DATA_DIR: electronData });
run("npm", ["run", "smoke", "--workspace", "@studynarrator/server"], { STUDYNARRATOR_DATA_DIR: nodeData });

process.stdout.write(`\nGATE ${gate}: AUTOMATED CHECKS PASSED\n`);
