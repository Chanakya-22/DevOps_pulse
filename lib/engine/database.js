const fs = require('fs');
const path = require('path');
const {
  APPLICATION_STATE_DIR: DB_DIR,
  AUDIT_HISTORY_PATH: DB_FILE
} = require('./applicationState');

function projectCounts(counts = {}) {
  return {
    criticalCount: counts.criticalCount || 0,
    warningCount: counts.warningCount || 0,
    infoCount: counts.infoCount || 0,
    passCount: counts.passCount || 0
  };
}

function projectIssues(issues = []) {
  return issues.map(issue => {
    const type = typeof issue.type === 'string' ? issue.type : 'INFO';
    const category = typeof issue.category === 'string' ? issue.category : 'Audit';
    return {
      type,
      category,
      message: `${category} ${type.toLowerCase()} finding.`
    };
  });
}

function projectAnnotations(annotations = []) {
  return annotations.map(annotation => ({
    line: Number.isInteger(annotation.line) ? annotation.line : 1,
    type: typeof annotation.type === 'string' ? annotation.type : 'INFO',
    category: typeof annotation.category === 'string' ? annotation.category : 'Audit',
    message: 'Historical source evidence was omitted.',
    recommendation: 'Review the current source file for remediation details.'
  }));
}

function projectAnnotatedFiles(annotatedFiles = {}) {
  return Object.fromEntries(Object.entries(annotatedFiles).map(([file, data]) => {
    const annotations = projectAnnotations(data.annotations || []);
    const lastLine = annotations.reduce((maximum, annotation) => Math.max(maximum, annotation.line), 1);
    return [file, {
      content: Array(lastLine).fill('[source omitted]').join('\n'),
      annotations
    }];
  }));
}

function projectProjectRoot(projectRoot) {
  if (typeof projectRoot !== 'string') {
    return '';
  }

  if (/^https?:\/\//i.test(projectRoot)) {
    try {
      const url = new URL(projectRoot);
      url.username = '';
      url.password = '';
      url.search = '';
      url.hash = '';
      return url.toString();
    } catch (e) {}
  }

  return projectRoot;
}

function projectAuditData(auditData = {}) {
  const structure = auditData.structure || {};
  const git = structure.git || {};
  const dependencies = auditData.dependencies || {};
  const security = auditData.security || {};
  const cicd = auditData.cicd || {};
  const pillars = Object.fromEntries(Object.entries(auditData.pillars || {}).map(([key, pillar]) => [key, {
    score: pillar.score,
    label: pillar.label,
    weight: pillar.weight
  }]));

  return {
    timestamp: auditData.timestamp || null,
    projectRoot: projectProjectRoot(auditData.projectRoot),
    score: auditData.score,
    grade: auditData.grade,
    statusColor: auditData.statusColor,
    statusSummary: auditData.statusSummary,
    counts: projectCounts(auditData.counts),
    pillars,
    structure: {
      totalFiles: structure.totalFiles || 0,
      totalDirs: structure.totalDirs || 0,
      totalLinesOfCode: structure.totalLinesOfCode || 0,
      fileTypes: structure.fileTypes || {},
      languages: structure.languages || {},
      detectedStack: structure.detectedStack || [],
      keyFiles: structure.keyFiles || [],
      structureTree: structure.structureTree || [],
      maxDepthReached: Boolean(structure.maxDepthReached),
      git: {
        isGitRepo: Boolean(git.isGitRepo),
        branch: git.branch || 'unknown',
        lastCommitHash: git.lastCommitHash || null,
        lastCommitDate: git.lastCommitDate || null,
        totalCommits: git.totalCommits || 0,
        uniqueContributors: git.uniqueContributors || 0,
        hasUncommittedChanges: Boolean(git.hasUncommittedChanges)
      }
    },
    dependencies: {
      hasDependencyFile: Boolean(dependencies.hasDependencyFile),
      hasLockfile: Boolean(dependencies.hasLockfile),
      lockfileType: dependencies.lockfileType || null,
      totalDependencies: dependencies.totalDependencies || 0,
      pinnedDependencies: dependencies.pinnedDependencies || 0,
      unpinnedCount: dependencies.unpinnedCount || 0,
      missingScripts: dependencies.missingScripts || [],
      issues: projectIssues(dependencies.issues),
      details: {
        totalDependencies: dependencies.totalDependencies || 0,
        pinnedDependencies: dependencies.pinnedDependencies || 0,
        unpinnedDependencies: dependencies.unpinnedCount || 0
      }
    },
    security: {
      leakedSecrets: (security.leakedSecrets || []).map(finding => ({
        file: finding.file,
        line: finding.line,
        secretType: finding.secretType
      })),
      committedCerts: security.committedCerts || [],
      envIssues: [],
      issues: projectIssues(security.issues)
    },
    cicd: {
      hasGitHubWorkflows: Boolean(cicd.hasGitHubWorkflows),
      hasDockerfile: Boolean(cicd.hasDockerfile),
      hasDockerIgnore: Boolean(cicd.hasDockerIgnore),
      hasDockerCompose: Boolean(cicd.hasDockerCompose),
      hasReadme: Boolean(cicd.hasReadme),
      hasLicense: Boolean(cicd.hasLicense),
      hasGitignore: Boolean(cicd.hasGitignore),
      cicdProvider: cicd.cicdProvider || null,
      issues: projectIssues(cicd.issues),
      foundPipelines: cicd.foundPipelines || [],
      details: {
        workflowAudits: (cicd.details?.workflowAudits || []).map(audit => ({
          file: audit.file,
          usesUnpinnedAction: Boolean(audit.usesUnpinnedAction),
          missingCache: Boolean(audit.missingCache),
          usesNpmInstall: Boolean(audit.usesNpmInstall),
          hasHardcodedSecret: Boolean(audit.hasHardcodedSecret)
        })),
        dockerfileAudits: (cicd.details?.dockerfileAudits || []).map(audit => ({
          isMultiStage: Boolean(audit.isMultiStage),
          runsAsRoot: Boolean(audit.runsAsRoot),
          cleanPackageCache: Boolean(audit.cleanPackageCache),
          hasExpose: Boolean(audit.hasExpose),
          hasHealthcheck: Boolean(audit.hasHealthcheck),
          usesAdd: Boolean(audit.usesAdd)
        }))
      },
      annotatedFiles: projectAnnotatedFiles(cicd.annotatedFiles)
    },
    allIssues: projectIssues(auditData.allIssues),
    suggestions: (auditData.suggestions || []).map(suggestion => ({
      id: suggestion.id,
      title: suggestion.title,
      actionText: suggestion.actionText,
      description: suggestion.description,
      priority: suggestion.priority,
      targetFile: suggestion.targetFile
    }))
  };
}

function createHistoryRecord(auditData) {
  const fullData = projectAuditData(auditData);
  return {
    id: `scan-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    schemaVersion: 2,
    timestamp: fullData.timestamp || new Date().toISOString(),
    projectRoot: fullData.projectRoot,
    score: fullData.score,
    grade: fullData.grade,
    statusColor: fullData.statusColor,
    statusSummary: fullData.statusSummary,
    counts: fullData.counts,
    detectedStack: fullData.structure.detectedStack,
    cicdProvider: fullData.cicd.cicdProvider || 'None',
    fullData
  };
}

function projectStoredRecord(record) {
  const projected = {
    id: record.id,
    timestamp: record.timestamp,
    projectRoot: projectProjectRoot(record.projectRoot),
    score: record.score,
    grade: record.grade,
    statusColor: record.statusColor,
    statusSummary: record.statusSummary,
    counts: projectCounts(record.counts),
    detectedStack: record.detectedStack || [],
    cicdProvider: record.cicdProvider || 'None',
    fullData: projectAuditData(record.fullData)
  };
  if (record.schemaVersion) {
    projected.schemaVersion = record.schemaVersion;
  }
  return projected;
}

function createHistoryStore(historyFile = DB_FILE) {
  const dbDir = path.dirname(historyFile);

  function ensureDbExists() {
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    if (!fs.existsSync(historyFile)) {
      fs.writeFileSync(historyFile, JSON.stringify([], null, 2), 'utf-8');
    }
  }

  function readStoredHistory() {
    ensureDbExists();
    try {
      return JSON.parse(fs.readFileSync(historyFile, 'utf-8'));
    } catch (e) {
      return [];
    }
  }

  function getHistory() {
    return readStoredHistory().map(projectStoredRecord);
  }

  function saveAudit(auditData) {
    const history = readStoredHistory();
    const record = createHistoryRecord(auditData);

    history.unshift(record);
    fs.writeFileSync(historyFile, JSON.stringify(history.slice(0, 50), null, 2), 'utf-8');

    return record.id;
  }

  function getAuditById(id) {
    const found = readStoredHistory().find(record => record.id === id);
    return found?.fullData ? projectAuditData(found.fullData) : null;
  }

  function deleteAudit(id) {
    const filtered = readStoredHistory().filter(record => record.id !== id);
    fs.writeFileSync(historyFile, JSON.stringify(filtered, null, 2), 'utf-8');
    return true;
  }

  return { getHistory, saveAudit, getAuditById, deleteAudit };
}

const defaultStore = createHistoryStore();

module.exports = {
  ...defaultStore,
  createHistoryStore
};
