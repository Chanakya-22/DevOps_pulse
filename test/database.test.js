const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createHistoryStore } = require('../lib/engine/database');

function createTempStore() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'devops-pulse-history-'));
  return {
    directory,
    historyFile: path.join(directory, 'history.json'),
    store: createHistoryStore(path.join(directory, 'history.json'))
  };
}

function createAudit() {
  const secretValue = ['SUPER_SECRET_', 'TEST_VALUE'].join('');
  const databaseScheme = ['post', 'gresql://'].join('');
  const databaseLocation = ['user', ':', secretValue, '@localhost/db'].join('');
  const snippet = `DATABASE_URL=${databaseScheme}${databaseLocation}`;
  return {
    timestamp: '2026-09-30T00:00:00.000Z',
    projectRoot: 'https://user:password@example.test/repository?access_token=hidden',
    score: 86,
    grade: 'B',
    statusColor: 'yellow',
    statusSummary: 'Good - Fully Functional, Recommend Minor Hardening',
    counts: { criticalCount: 1, warningCount: 2, infoCount: 3, passCount: 4 },
    pillars: {
      pipeline: { score: 100, label: 'Pipeline Automation', weight: '30%' },
      security: { score: 80, label: 'Security & Secrets', weight: '30%' }
    },
    structure: {
      totalFiles: 12,
      totalDirs: 3,
      totalLinesOfCode: 500,
      fileTypes: { '.js': 4 },
      languages: { JavaScript: 4 },
      detectedStack: ['Node.js'],
      keyFiles: ['package.json'],
      structureTree: [{ type: 'file', path: 'app.js', depth: 0 }],
      maxDepthReached: false,
      git: {
        isGitRepo: true,
        branch: 'main',
        lastCommitHash: 'abc1234',
        lastCommitDate: '2026-09-29',
        lastCommitAuthor: secretValue,
        lastCommitMessage: snippet,
        totalCommits: 10,
        uniqueContributors: 2,
        hasUncommittedChanges: false
      }
    },
    dependencies: {
      hasDependencyFile: true,
      hasLockfile: true,
      lockfileType: 'npm',
      totalDependencies: 4,
      pinnedDependencies: 3,
      unpinnedCount: 1,
      missingScripts: ['lint'],
      issues: [{ type: 'WARNING', category: 'Dependencies', message: snippet }],
      details: { packageName: secretValue, scripts: { test: snippet } }
    },
    security: {
      leakedSecrets: [{ file: 'src/config.js', line: 4, secretType: 'Database URL', secretValue, snippet, evidence: snippet }],
      committedCerts: [],
      envIssues: [snippet],
      issues: [{ type: 'CRITICAL', category: 'Security', message: snippet }]
    },
    cicd: {
      hasGitHubWorkflows: true,
      hasDockerfile: true,
      hasDockerIgnore: true,
      hasDockerCompose: false,
      hasReadme: true,
      hasLicense: true,
      hasGitignore: true,
      cicdProvider: 'GitHub Actions',
      issues: [{ type: 'WARNING', category: 'Docker', message: snippet }],
      foundPipelines: ['.github/workflows/ci.yml'],
      details: {
        workflowAudits: [{ file: 'ci.yml', usesUnpinnedAction: false, missingCache: false, usesNpmInstall: false, hasHardcodedSecret: false }],
        dockerfileAudits: [{ baseImage: snippet, baseImageTag: secretValue, isMultiStage: true, runsAsRoot: false, cleanPackageCache: true, hasExpose: true, hasHealthcheck: true, usesAdd: false }]
      },
      annotatedFiles: {
        Dockerfile: {
          content: snippet,
          annotations: [{ line: 2, type: 'WARNING', category: 'Docker', message: snippet, recommendation: snippet }]
        }
      }
    },
    allIssues: [{ type: 'CRITICAL', category: 'Security', message: snippet }],
    suggestions: [{ id: 'FIX', title: 'Fix security', actionText: 'Review', description: 'Review findings', priority: 'HIGH', targetFile: 'src/config.js' }],
    secretValue,
    rawSource: snippet
  };
}

test('persists a sanitized historical audit without mutating the live audit object', t => {
  const { directory, historyFile, store } = createTempStore();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const audit = createAudit();
  const original = structuredClone(audit);

  const id = store.saveAudit(audit);
  const storedText = fs.readFileSync(historyFile, 'utf-8');
  const storedRecord = JSON.parse(storedText)[0];
  const detail = store.getAuditById(id);

  assert.deepEqual(audit, original);
  assert.equal(storedRecord.score, 86);
  assert.equal(storedRecord.grade, 'B');
  assert.deepEqual(storedRecord.fullData.pillars, {
    pipeline: { score: 100, label: 'Pipeline Automation', weight: '30%' },
    security: { score: 80, label: 'Security & Secrets', weight: '30%' }
  });
  assert.deepEqual(storedRecord.fullData.security.leakedSecrets, [
    { file: 'src/config.js', line: 4, secretType: 'Database URL' }
  ]);
  assert.deepEqual(detail.security.leakedSecrets, storedRecord.fullData.security.leakedSecrets);
  assert.equal(storedRecord.fullData.cicd.annotatedFiles.Dockerfile.content, '[source omitted]\n[source omitted]');
  assert.equal(storedRecord.fullData.dependencies.issues[0].message, 'Dependencies warning finding.');
  assert.ok(!storedText.includes(audit.secretValue));
  assert.ok(!storedText.includes('DATABASE_URL='));
  assert.ok(!storedText.includes('access_token=hidden'));
  assert.equal(storedRecord.schemaVersion, 2);
});

test('preserves history list summaries and reads legacy records without rewriting them', t => {
  const { directory, historyFile, store } = createTempStore();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const audit = createAudit();
  const legacyRecord = {
    id: 'legacy-record',
    timestamp: audit.timestamp,
    projectRoot: audit.projectRoot,
    score: audit.score,
    grade: audit.grade,
    statusColor: audit.statusColor,
    statusSummary: audit.statusSummary,
    counts: audit.counts,
    detectedStack: audit.structure.detectedStack,
    cicdProvider: audit.cicd.cicdProvider,
    fullData: audit
  };
  fs.writeFileSync(historyFile, JSON.stringify([legacyRecord]), 'utf-8');
  const originalStoredText = fs.readFileSync(historyFile, 'utf-8');

  const listed = store.getHistory();
  const detail = store.getAuditById('legacy-record');

  assert.equal(listed[0].id, 'legacy-record');
  assert.equal(listed[0].score, 86);
  assert.equal(listed[0].grade, 'B');
  assert.equal(detail.score, 86);
  assert.equal(detail.security.leakedSecrets[0].snippet, undefined);
  assert.ok(!JSON.stringify(listed).includes(audit.secretValue));
  assert.ok(!JSON.stringify(detail).includes(audit.secretValue));
  assert.equal(fs.readFileSync(historyFile, 'utf-8'), originalStoredText);
});

test('retains only the newest 50 records', t => {
  const { directory, store } = createTempStore();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  for (let index = 0; index < 55; index++) {
    const audit = createAudit();
    audit.timestamp = new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString();
    audit.score = index;
    store.saveAudit(audit);
  }

  const history = store.getHistory();
  assert.equal(history.length, 50);
  assert.equal(history[0].score, 54);
  assert.equal(history[49].score, 5);
});