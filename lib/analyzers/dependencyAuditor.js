const fs = require('fs');
const path = require('path');

function auditDependencies(targetDir, structureStats) {
  const audit = {
    hasDependencyFile: false,
    hasLockfile: false,
    lockfileType: null,
    unpinnedCount: 0,
    missingScripts: [],
    issues: [],
    details: {}
  };

  const keyFiles = new Set(structureStats.keyFiles);

  // 1. Node.js audit
  if (keyFiles.has('package.json')) {
    audit.hasDependencyFile = true;
    const pkgPath = path.join(targetDir, 'package.json');
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      audit.details.packageName = pkg.name || 'unnamed-package';
      audit.details.scripts = pkg.scripts || {};

      // Check essential scripts
      const scripts = pkg.scripts || {};
      if (!scripts.test || scripts.test.includes('no test specified')) {
        audit.missingScripts.push('test');
        audit.issues.push({
          type: 'WARNING',
          category: 'Scripts',
          message: 'No active test script configured in package.json'
        });
      }
      if (!scripts.build && (pkg.dependencies?.react || pkg.dependencies?.next || pkg.dependencies?.vue || pkg.devDependencies?.typescript)) {
        audit.missingScripts.push('build');
        audit.issues.push({
          type: 'WARNING',
          category: 'Scripts',
          message: 'Missing build script for frontend / TypeScript app in package.json'
        });
      }
      if (!scripts.lint) {
        audit.missingScripts.push('lint');
        audit.issues.push({
          type: 'INFO',
          category: 'Scripts',
          message: 'No lint script defined in package.json'
        });
      }

      // Check lockfile
      if (keyFiles.has('package-lock.json')) {
        audit.hasLockfile = true;
        audit.lockfileType = 'npm (package-lock.json)';
      } else if (keyFiles.has('yarn.lock')) {
        audit.hasLockfile = true;
        audit.lockfileType = 'Yarn (yarn.lock)';
      } else if (keyFiles.has('pnpm-lock.yaml')) {
        audit.hasLockfile = true;
        audit.lockfileType = 'pnpm (pnpm-lock.yaml)';
      } else {
        audit.issues.push({
          type: 'CRITICAL',
          category: 'Dependencies',
          message: 'Missing lockfile (package-lock.json / yarn.lock / pnpm-lock.yaml). Builds may be non-deterministic across environments.'
        });
      }

      // Check dependency pinning
      const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      audit.details.totalDependencies = Object.keys(allDeps).length;

      for (const [dep, ver] of Object.entries(allDeps)) {
        if (ver === '*' || ver === 'latest' || ver.startsWith('>=')) {
          audit.unpinnedCount++;
        }
      }

      if (audit.unpinnedCount > 0) {
        audit.issues.push({
          type: 'WARNING',
          category: 'Dependencies',
          message: `Found ${audit.unpinnedCount} unpinned dependency specs ("*" or "latest"), which can cause breaking changes during automatic deployments.`
        });
      }

    } catch (err) {
      audit.issues.push({
        type: 'CRITICAL',
        category: 'Dependencies',
        message: 'Invalid package.json format (JSON parse error)'
      });
    }
  }

  // 2. Python audit
  if (keyFiles.has('requirements.txt')) {
    audit.hasDependencyFile = true;
    try {
      const content = fs.readFileSync(path.join(targetDir, 'requirements.txt'), 'utf-8');
      const lines = content.split(/\r?\n/).filter(l => l.trim() && !l.trim().startsWith('#'));
      audit.details.pythonDepCount = lines.length;
      const unpinnedPy = lines.filter(l => !l.includes('==')).length;
      if (unpinnedPy > 0) {
        audit.issues.push({
          type: 'WARNING',
          category: 'Dependencies',
          message: `${unpinnedPy} dependencies in requirements.txt do not specify exact versions (==).`
        });
      }
    } catch (e) {}
  }

  if (!audit.hasDependencyFile && structureStats.totalFiles > 3) {
    audit.issues.push({
      type: 'WARNING',
      category: 'Dependencies',
      message: 'No standard dependency manifest file found (package.json, requirements.txt, go.mod, Cargo.toml).'
    });
  }

  return audit;
}

module.exports = { auditDependencies };
