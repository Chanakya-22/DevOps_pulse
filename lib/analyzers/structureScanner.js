const fs = require('fs');
const path = require('path');

const DEFAULT_IGNORES = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.nuxt',
  'coverage',
  'venv',
  '.venv',
  'env',
  '__pycache__',
  '.pytest_cache',
  'target',
  'vendor',
  '.idea',
  '.vscode',
  'bin',
  'obj'
]);

/**
 * Parses .gitignore if present in project root
 */
function getCustomIgnores(targetDir) {
  const ignores = new Set(DEFAULT_IGNORES);
  const gitignorePath = path.join(targetDir, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    try {
      const content = fs.readFileSync(gitignorePath, 'utf-8');
      content.split(/\r?\n/).forEach(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const clean = trimmed.replace(/^\//, '').replace(/\/$/, '').replace(/\/\*$/, '');
          if (clean) ignores.add(clean);
        }
      });
    } catch (e) {
      // Ignore read errors
    }
  }
  return ignores;
}

/**
 * Scans directory structure recursively
 */
function scanStructure(targetDir) {
  const ignores = getCustomIgnores(targetDir);
  const stats = {
    totalFiles: 0,
    totalDirs: 0,
    fileTypes: {},
    detectedStack: [],
    keyFiles: [],
    structureTree: [],
    maxDepthReached: false
  };

  const keyFilePatterns = [
    'package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
    'requirements.txt', 'pyproject.toml', 'Pipfile', 'setup.py',
    'Cargo.toml', 'go.mod', 'pom.xml', 'build.gradle',
    'Dockerfile', 'docker-compose.yml', 'docker-compose.yaml',
    'README.md', 'LICENSE', '.gitignore', '.env', '.env.example',
    'tsconfig.json', '.eslintrc', '.eslintrc.json', '.eslintrc.js', '.prettierrc',
    'vitest.config.js', 'jest.config.js', 'pytest.ini'
  ];

  function traverse(currentDir, currentDepth = 0, relativePath = '') {
    if (currentDepth > 8) {
      stats.maxDepthReached = true;
      return;
    }

    let entries = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch (err) {
      return;
    }

    for (const entry of entries) {
      const entryRelative = relativePath ? path.join(relativePath, entry.name) : entry.name;

      if (ignores.has(entry.name) || entry.name.startsWith('.git')) {
        continue;
      }

      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        stats.totalDirs++;
        if (currentDepth < 3) {
          stats.structureTree.push({ type: 'dir', path: entryRelative, depth: currentDepth });
        }
        traverse(fullPath, currentDepth + 1, entryRelative);
      } else if (entry.isFile()) {
        stats.totalFiles++;
        const ext = path.extname(entry.name).toLowerCase() || 'no-extension';
        stats.fileTypes[ext] = (stats.fileTypes[ext] || 0) + 1;

        if (keyFilePatterns.includes(entry.name) || entryRelative.startsWith('.github')) {
          stats.keyFiles.push(entryRelative.replace(/\\/g, '/'));
        }

        if (currentDepth < 2) {
          stats.structureTree.push({ type: 'file', path: entryRelative, depth: currentDepth });
        }
      }
    }
  }

  traverse(targetDir);

  // Detect Tech Stack
  const keyFilesSet = new Set(stats.keyFiles);
  if (keyFilesSet.has('package.json')) {
    stats.detectedStack.push('Node.js / JavaScript / TypeScript');
    const pkgPath = path.join(targetDir, 'package.json');
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      if (deps['react']) stats.detectedStack.push('React');
      if (deps['next']) stats.detectedStack.push('Next.js');
      if (deps['vue']) stats.detectedStack.push('Vue');
      if (deps['express']) stats.detectedStack.push('Express');
      if (deps['nest'] || deps['@nestjs/core']) stats.detectedStack.push('NestJS');
      if (deps['typescript']) stats.detectedStack.push('TypeScript');
    } catch (e) {}
  }

  if (keyFilesSet.has('requirements.txt') || keyFilesSet.has('pyproject.toml') || keyFilesSet.has('Pipfile')) {
    stats.detectedStack.push('Python');
  }
  if (keyFilesSet.has('go.mod')) stats.detectedStack.push('Go');
  if (keyFilesSet.has('Cargo.toml')) stats.detectedStack.push('Rust');
  if (keyFilesSet.has('pom.xml') || keyFilesSet.has('build.gradle')) stats.detectedStack.push('Java');
  if (keyFilesSet.has('Dockerfile')) stats.detectedStack.push('Docker');

  if (stats.detectedStack.length === 0) {
    if (stats.fileTypes['.html']) stats.detectedStack.push('Static HTML/CSS/JS');
    else stats.detectedStack.push('Generic Codebase');
  }

  return stats;
}

module.exports = { scanStructure };
