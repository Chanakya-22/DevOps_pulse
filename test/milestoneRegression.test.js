const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { scanSecurity } = require('../lib/analyzers/securityScanner');
const { scanStructure } = require('../lib/analyzers/structureScanner');
const { createHistoryStore } = require('../lib/engine/database');
const { analyzeProject } = require('../lib/engine/devopsAdvisor');
const { createRepositoryBoundary } = require('../lib/engine/repositoryBoundary');
const { createRepositoryInventory } = require('../lib/engine/repositoryWalker');

let activeHistoryStore;
const database = require('../lib/engine/database');
database.getHistory = (...args) => activeHistoryStore.getHistory(...args);
database.saveAudit = (...args) => activeHistoryStore.saveAudit(...args);
database.getAuditById = (...args) => activeHistoryStore.getAuditById(...args);
database.deleteAudit = (...args) => activeHistoryStore.deleteAudit(...args);
const { startServer } = require('../lib/web/server');

const repositoryRoot = path.resolve(__dirname, '..');

function auditSignature(audit) {
  return {
    score: audit.score,
    grade: audit.grade,
    pillars: Object.fromEntries(Object.entries(audit.pillars).map(([name, pillar]) => [name, pillar.score])),
    counts: audit.counts,
    leakedSecrets: audit.security.leakedSecrets.map(finding => ({
      file: finding.file,
      line: finding.line,
      secretType: finding.secretType
    }))
  };
}

test('structure and security use the effective shared inventory boundary', () => {
  const boundary = createRepositoryBoundary(repositoryRoot);
  const inventory = createRepositoryInventory(boundary);
  const historyRelativePath = path.relative(repositoryRoot, require('../lib/engine/applicationState').AUDIT_HISTORY_PATH).replace(/\\/g, '/');
  const structure = scanStructure(repositoryRoot, inventory);
  const security = scanSecurity(repositoryRoot, structure, inventory);
  const audit = analyzeProject(repositoryRoot);

  assert.ok(!inventory.files.some(file => file.relativePath === historyRelativePath));
  assert.ok(!security.leakedSecrets.some(finding => finding.file === historyRelativePath));
  assert.deepEqual(security, audit.security);
  assert.ok(inventory.files.some(file => file.relativePath === 'lib/analyzers/securityScanner.js'));
  assert.equal(structure.totalFiles, audit.structure.totalFiles);
});

test('five sequential web audits remain stable and history APIs return sanitized records', async t => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'devops-pulse-milestone-'));
  const historyFile = path.join(tempDirectory, 'history.json');
  activeHistoryStore = createHistoryStore(historyFile);
  const server = startServer(repositoryRoot, 0);
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    activeHistoryStore = null;
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });
  await new Promise(resolve => server.once('listening', resolve));

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const dashboardResponse = await fetch(baseUrl);
  assert.equal(dashboardResponse.status, 200);
  assert.ok((await dashboardResponse.text()).includes('DevOps Pulse'));

  const audits = [];
  for (let index = 0; index < 5; index++) {
    const response = await fetch(`${baseUrl}/api/audit`);
    assert.equal(response.status, 200);
    const audit = await response.json();
    assert.ok(audit.structure);
    assert.ok(audit.security);
    assert.ok(audit.dependencies);
    assert.ok(audit.cicd);
    audits.push(audit);
  }

  const expectedSignature = auditSignature(audits[0]);
  audits.slice(1).forEach(audit => assert.deepEqual(auditSignature(audit), expectedSignature));

  const historyResponse = await fetch(`${baseUrl}/api/history`);
  assert.equal(historyResponse.status, 200);
  const history = await historyResponse.json();
  assert.equal(history.length, 5);
  assert.equal(history[0].schemaVersion, 2);
  assert.equal(history[0].score, audits[4].score);
  assert.equal(history[0].grade, audits[4].grade);
  assert.deepEqual(history[0].fullData.pillars, audits[4].pillars);
  assert.ok(!JSON.stringify(history).includes('snippet'));

  const detailResponse = await fetch(`${baseUrl}/api/history/${history[0].id}`);
  assert.equal(detailResponse.status, 200);
  const detail = await detailResponse.json();
  assert.equal(detail.score, audits[4].score);
  assert.equal(detail.grade, audits[4].grade);
  assert.deepEqual(detail.pillars, audits[4].pillars);
  assert.ok(!JSON.stringify(detail).includes('snippet'));
  assert.ok(!fs.readFileSync(historyFile, 'utf-8').includes('snippet'));
});

test('CLI JSON retains the audit shape and check mode passes without a pinned score', () => {
  const cliPath = path.join(repositoryRoot, 'bin', 'cli.js');
  const jsonResult = spawnSync(process.execPath, [cliPath, '--json'], {
    cwd: repositoryRoot,
    encoding: 'utf-8'
  });

  assert.equal(jsonResult.status, 0, jsonResult.stderr);
  const audit = JSON.parse(jsonResult.stdout);
  assert.equal(typeof audit.score, 'number');
  assert.equal(typeof audit.grade, 'string');
  assert.ok(audit.pillars && audit.counts && audit.structure);
  assert.ok(audit.security && audit.dependencies && audit.cicd);
  assert.ok(Array.isArray(audit.allIssues));
  assert.ok(Array.isArray(audit.suggestions));

  const checkResult = spawnSync(process.execPath, [cliPath, '--check'], {
    cwd: repositoryRoot,
    encoding: 'utf-8'
  });
  assert.equal(checkResult.status, 0, checkResult.stdout + checkResult.stderr);
  assert.match(checkResult.stdout, /PASS/);
});