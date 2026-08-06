const fs = require('fs');
const path = require('path');

function auditDependencies(targetDir, structureStats) {
  const audit = {
    hasDependencyFile: false,
    hasLockfile: false,
    lockfileType: null,
    totalDependencies: 0,
    pinnedDependencies: 0,
    unpinnedCount: 0,
    missingScripts: [],
    issues: [],
    details: {}
  };

  const keyFiles = new Set(structureStats.keyFiles);

  // Helper to add issue
  function addIssue(type, category, message) {
    audit.issues.push({ type, category, message });
  }

  // Helper to check version pinning
  // Returns true if pinned, false if loose
  function isPinnedNode(ver) {
    if (!ver) return false;
    // Pinned version does not start with ^, ~, >, <, *, or latest
    const clean = ver.trim();
    if (clean === '*' || clean === 'latest') return false;
    if (clean.startsWith('^') || clean.startsWith('~') || clean.startsWith('>') || clean.startsWith('<') || clean.startsWith('=')) {
      if (clean.startsWith('==') || clean.startsWith('=')) return true; // Some systems allow =1.0.0
      return false;
    }
    return true; // e.g. "1.2.3" or "git+https"
  }

  // 1. Node.js audit
  if (keyFiles.has('package.json')) {
    audit.hasDependencyFile = true;
    const pkgPath = path.join(targetDir, 'package.json');
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      audit.details.packageName = pkg.name || 'unnamed-package';
      audit.details.scripts = pkg.scripts || {};

      const scripts = pkg.scripts || {};
      
      // Check essential scripts
      if (!scripts.test || scripts.test.includes('no test specified')) {
        audit.missingScripts.push('test');
        addIssue('WARNING', 'Scripts', 'No active test runner defined in package.json. Automated CI test steps will fail or be skipped.');
      }
      
      const hasFrontend = pkg.dependencies?.react || pkg.dependencies?.next || pkg.dependencies?.vue || pkg.dependencies?.svelte || pkg.devDependencies?.typescript;
      if (!scripts.build && hasFrontend) {
        audit.missingScripts.push('build');
        addIssue('WARNING', 'Scripts', 'Missing build script in package.json for application requiring compilations or bundling.');
      }
      
      if (!scripts.lint) {
        audit.missingScripts.push('lint');
        addIssue('INFO', 'Scripts', 'No lint script defined in package.json. Static code quality checks are highly recommended.');
      }

      // Check lockfiles
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
        addIssue('CRITICAL', 'Dependencies', 'Missing Node.js lockfile (package-lock.json / yarn.lock / pnpm-lock.yaml). This risks non-deterministic builds across different environments.');
      }

      // Check dependency pinning
      const deps = pkg.dependencies || {};
      const devDeps = pkg.devDependencies || {};
      const allDeps = { ...deps, ...devDeps };
      
      const total = Object.keys(allDeps).length;
      audit.totalDependencies += total;
      
      let localUnpinned = 0;
      for (const [dep, ver] of Object.entries(allDeps)) {
        if (!isPinnedNode(ver)) {
          localUnpinned++;
          audit.unpinnedCount++;
        } else {
          audit.pinnedDependencies++;
        }
      }

      if (localUnpinned > 0) {
        const percent = Math.round((localUnpinned / total) * 100);
        addIssue('WARNING', 'Dependencies', `Found ${localUnpinned} unpinned or loose dependencies in package.json (${percent}% of total). Use exact versions to avoid breaking builds when dependencies publish updates.`);
      } else if (total > 0) {
        addIssue('PASS', 'Dependencies', `All ${total} Node.js dependencies are strictly version-pinned.`);
      }

    } catch (err) {
      addIssue('CRITICAL', 'Dependencies', 'Failed to parse package.json. File is malformed or invalid JSON.');
    }
  }

  // 2. Python audit
  if (keyFiles.has('requirements.txt') || keyFiles.has('pyproject.toml') || keyFiles.has('Pipfile')) {
    audit.hasDependencyFile = true;
    
    // Check requirements.txt
    if (keyFiles.has('requirements.txt')) {
      try {
        const content = fs.readFileSync(path.join(targetDir, 'requirements.txt'), 'utf-8');
        const lines = content.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
        
        audit.totalDependencies += lines.length;
        let unpinnedPy = 0;
        lines.forEach(line => {
          // If it doesn't contain ==, or contains >=, <=, or looks like a URL without a pinned revision
          if (!line.includes('==') && !line.includes('@')) {
            unpinnedPy++;
            audit.unpinnedCount++;
          } else {
            audit.pinnedDependencies++;
          }
        });

        if (unpinnedPy > 0) {
          addIssue('WARNING', 'Dependencies', `Found ${unpinnedPy} unpinned requirements in requirements.txt (missing "==" specifiers). This can result in unexpected library updates.`);
        }
      } catch (e) {}
    }

    // Check python lockfiles
    const hasPyLock = keyFiles.has('poetry.lock') || keyFiles.has('Pipfile.lock') || keyFiles.has('requirements.txt'); // requirements.txt acts as lockfile if all are pinned
    if (keyFiles.has('poetry.lock') || keyFiles.has('Pipfile.lock')) {
      audit.hasLockfile = true;
      audit.lockfileType = keyFiles.has('poetry.lock') ? 'Poetry (poetry.lock)' : 'Pipenv (Pipfile.lock)';
    }
  }

  // 3. Go audit
  if (keyFiles.has('go.mod')) {
    audit.hasDependencyFile = true;
    if (keyFiles.has('go.sum')) {
      audit.hasLockfile = true;
      audit.lockfileType = 'Go Sum (go.sum)';
    } else {
      addIssue('CRITICAL', 'Dependencies', 'Found go.mod but missing go.sum check-sum file. Running go build might download insecure or modified modules.');
    }

    // Parse go.mod dependencies
    try {
      const content = fs.readFileSync(path.join(targetDir, 'go.mod'), 'utf-8');
      const lines = content.split(/\r?\n/);
      let goDepCount = 0;
      lines.forEach(line => {
        const trimmed = line.trim();
        // Look for lines containing vX.Y.Z
        if (trimmed.startsWith('require') || (trimmed && !trimmed.startsWith('module') && !trimmed.startsWith('go') && !trimmed.startsWith(')') && !trimmed.startsWith('(') && trimmed.includes(' v'))) {
          goDepCount++;
          // Go dependencies are generally pinned to semver, but we track count
          audit.pinnedDependencies++;
          audit.totalDependencies++;
        }
      });
    } catch (e) {}
  }

  // 4. Rust audit
  if (keyFiles.has('Cargo.toml')) {
    audit.hasDependencyFile = true;
    if (keyFiles.has('Cargo.lock')) {
      audit.hasLockfile = true;
      audit.lockfileType = 'Cargo Lock (Cargo.lock)';
    } else {
      addIssue('WARNING', 'Dependencies', 'Found Cargo.toml but missing Cargo.lock. Binaries should always commit lockfiles for reproducible builds.');
    }
  }

  // 5. PHP audit
  if (keyFiles.has('composer.json')) {
    audit.hasDependencyFile = true;
    if (keyFiles.has('composer.lock')) {
      audit.hasLockfile = true;
      audit.lockfileType = 'Composer (composer.lock)';
    } else {
      addIssue('CRITICAL', 'Dependencies', 'composer.json detected but missing composer.lock. Server deployments could break if vendor libraries update.');
    }
  }

  // 6. Ruby audit
  if (keyFiles.has('Gemfile')) {
    audit.hasDependencyFile = true;
    if (keyFiles.has('Gemfile.lock')) {
      audit.hasLockfile = true;
      audit.lockfileType = 'Bundler (Gemfile.lock)';
    } else {
      addIssue('WARNING', 'Dependencies', 'Gemfile detected but missing Gemfile.lock. Vendor environment parity cannot be guaranteed.');
    }
  }

  // 7. General Manifest Missing Warning
  if (!audit.hasDependencyFile && structureStats.totalFiles > 4) {
    addIssue('WARNING', 'Dependencies', 'No standard package configuration file found (such as package.json, requirements.txt, go.mod, Cargo.toml).');
  }

  // Return final calculated metrics
  audit.details.totalDependencies = audit.totalDependencies;
  audit.details.pinnedDependencies = audit.pinnedDependencies;
  audit.details.unpinnedDependencies = audit.unpinnedCount;

  return audit;
}

module.exports = { auditDependencies };
