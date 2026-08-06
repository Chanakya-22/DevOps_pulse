const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

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
  'obj',
  'out',
  'cache',
  '.cache',
  'tmp',
  'temp'
]);

// Map file extensions to human readable languages
const LANGUAGE_MAP = {
  '.js': 'JavaScript',
  '.jsx': 'React JS',
  '.ts': 'TypeScript',
  '.tsx': 'React TS',
  '.py': 'Python',
  '.go': 'Go',
  '.rs': 'Rust',
  '.java': 'Java',
  '.cpp': 'C++',
  '.c': 'C',
  '.h': 'C/C++ Header',
  '.cs': 'C#',
  '.rb': 'Ruby',
  '.php': 'PHP',
  '.sh': 'Shell Script',
  '.ps1': 'PowerShell',
  '.yml': 'YAML Config',
  '.yaml': 'YAML Config',
  '.json': 'JSON Config',
  '.html': 'HTML Document',
  '.css': 'CSS Stylesheet',
  '.md': 'Markdown Document',
  '.dockerignore': 'Docker Config',
  'dockerfile': 'Docker Config',
  'jenkinsfile': 'Jenkins Config'
};

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
          // Normalize gitignore patterns
          const clean = trimmed.replace(/^\//, '').replace(/\/$/, '').replace(/\/\*$/, '');
          if (clean && clean !== '.gitignore') ignores.add(clean);
        }
      });
    } catch (e) {
      // Ignore read errors
    }
  }
  return ignores;
}

/**
 * Executes a git command safely, returning null on failure
 */
function runGitCommand(cmd, cwd) {
  try {
    return execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (e) {
    return null;
  }
}

/**
 * Extracts Git metadata and history metrics
 */
function getGitMetadata(targetDir) {
  const gitMeta = {
    isGitRepo: false,
    branch: 'unknown',
    lastCommitHash: null,
    lastCommitAuthor: null,
    lastCommitDate: null,
    lastCommitMessage: null,
    totalCommits: 0,
    uniqueContributors: 0,
    hasUncommittedChanges: false
  };

  const isGit = runGitCommand('git rev-parse --is-inside-work-tree', targetDir);
  if (isGit === 'true') {
    gitMeta.isGitRepo = true;

    // Get active branch
    const branch = runGitCommand('git rev-parse --abbrev-ref HEAD', targetDir);
    if (branch) gitMeta.branch = branch;

    // Get last commit details
    const lastCommit = runGitCommand('git log -1 --format="%h|%an|%ad|%s"', targetDir);
    if (lastCommit) {
      const [hash, author, date, msg] = lastCommit.split('|');
      gitMeta.lastCommitHash = hash;
      gitMeta.lastCommitAuthor = author;
      gitMeta.lastCommitDate = date;
      gitMeta.lastCommitMessage = msg;
    }

    // Get total commits
    const totalCommits = runGitCommand('git rev-list --count HEAD', targetDir);
    if (totalCommits) {
      gitMeta.totalCommits = parseInt(totalCommits, 10) || 0;
    }

    // Get unique contributors count
    const contributors = runGitCommand('git log --format="%ae" | sort -u | wc -l', targetDir);
    if (contributors) {
      gitMeta.uniqueContributors = parseInt(contributors.trim(), 10) || 0;
    } else {
      // Fallback command if pipe wc -l is not supported on windows
      const rawContributors = runGitCommand('git log --format="%ae"', targetDir);
      if (rawContributors) {
        const emails = new Set(rawContributors.split(/\r?\n/).map(e => e.trim()).filter(Boolean));
        gitMeta.uniqueContributors = emails.size;
      }
    }

    // Check for dirty working tree
    const status = runGitCommand('git status --porcelain', targetDir);
    if (status !== null) {
      gitMeta.hasUncommittedChanges = status.length > 0;
    }
  }

  return gitMeta;
}

/**
 * Scans directory structure recursively
 */
function scanStructure(targetDir) {
  const ignores = getCustomIgnores(targetDir);
  const stats = {
    totalFiles: 0,
    totalDirs: 0,
    totalLinesOfCode: 0,
    fileTypes: {},
    languages: {},
    detectedStack: [],
    keyFiles: [],
    structureTree: [],
    maxDepthReached: false,
    git: getGitMetadata(targetDir)
  };

  const keyFilePatterns = [
    'package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
    'requirements.txt', 'pyproject.toml', 'Pipfile', 'setup.py', 'poetry.lock', 'Pipfile.lock',
    'Cargo.toml', 'Cargo.lock', 'go.mod', 'go.sum', 'pom.xml', 'build.gradle',
    'Dockerfile', '.dockerignore', 'docker-compose.yml', 'docker-compose.yaml',
    'README.md', 'LICENSE', 'LICENSE.md', '.gitignore', '.env', '.env.example', '.env.sample',
    'tsconfig.json', '.eslintrc', '.eslintrc.json', '.eslintrc.js', '.prettierrc',
    'vitest.config.js', 'jest.config.js', 'pytest.ini', 'Gemfile', 'Gemfile.lock',
    'composer.json', 'composer.lock', 'Makefile'
  ];

  let fileCountLimit = 1500; // Hard cap on LOC scanning to avoid hanging on massive folders

  function traverse(currentDir, currentDepth = 0, relativePath = '') {
    if (currentDepth > 10) {
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
      const cleanRelative = entryRelative.replace(/\\/g, '/');

      // Skip ignored folders
      if (entry.name === '.git' || (ignores.has(entry.name) && entry.name !== '.gitignore')) {
        continue;
      }

      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        stats.totalDirs++;
        if (currentDepth < 3) {
          stats.structureTree.push({ type: 'dir', path: cleanRelative, depth: currentDepth });
        }
        traverse(fullPath, currentDepth + 1, entryRelative);
      } else if (entry.isFile()) {
        stats.totalFiles++;
        const ext = path.extname(entry.name).toLowerCase() || 'no-extension';
        stats.fileTypes[ext] = (stats.fileTypes[ext] || 0) + 1;

        const langName = LANGUAGE_MAP[ext] || (entry.name.toLowerCase() === 'dockerfile' ? 'Docker Config' : 'Other');
        if (langName !== 'Other') {
          stats.languages[langName] = (stats.languages[langName] || 0) + 1;
        }

        if (keyFilePatterns.includes(entry.name) || cleanRelative.startsWith('.github/') || cleanRelative.startsWith('.gitlab/')) {
          stats.keyFiles.push(cleanRelative);
        }

        if (currentDepth < 2) {
          stats.structureTree.push({ type: 'file', path: cleanRelative, depth: currentDepth });
        }

        // Count lines of code (limit files count scanned to avoid performance issues)
        if (fileCountLimit > 0 && ['.js', '.ts', '.jsx', '.tsx', '.py', '.go', '.rs', '.java', '.cs', '.php', '.rb', '.sh', '.yml', '.yaml', '.html', '.css'].includes(ext)) {
          try {
            const fileStat = fs.statSync(fullPath);
            if (fileStat.size < 200000) { // Limit size to 200KB per file
              const fileContent = fs.readFileSync(fullPath, 'utf-8');
              const lines = fileContent.split(/\r?\n/).length;
              stats.totalLinesOfCode += lines;
              fileCountLimit--;
            }
          } catch (e) {}
        }
      }
    }
  }

  traverse(targetDir);

  // Detect Tech Stack
  const keyFilesSet = new Set(stats.keyFiles);
  
  // Node.js Stack
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
      if (deps['nuxt']) stats.detectedStack.push('Nuxt.js');
      if (deps['angular'] || deps['@angular/core']) stats.detectedStack.push('Angular');
    } catch (e) {}
  }

  // Python Stack
  if (keyFilesSet.has('requirements.txt') || keyFilesSet.has('pyproject.toml') || keyFilesSet.has('Pipfile') || keyFilesSet.has('poetry.lock')) {
    stats.detectedStack.push('Python');
    // Try to detect Django/Flask/FastAPI
    const pyprojectPath = path.join(targetDir, 'pyproject.toml');
    const reqPath = path.join(targetDir, 'requirements.txt');
    try {
      let pyContent = '';
      if (fs.existsSync(pyprojectPath)) pyContent = fs.readFileSync(pyprojectPath, 'utf-8');
      if (fs.existsSync(reqPath)) pyContent += fs.readFileSync(reqPath, 'utf-8');
      
      if (pyContent.includes('fastapi')) stats.detectedStack.push('FastAPI');
      else if (pyContent.includes('django') || pyContent.includes('Django')) stats.detectedStack.push('Django');
      else if (pyContent.includes('flask') || pyContent.includes('Flask')) stats.detectedStack.push('Flask');
    } catch (e) {}
  }

  // Go Stack
  if (keyFilesSet.has('go.mod')) {
    stats.detectedStack.push('Go');
  }

  // Rust Stack
  if (keyFilesSet.has('Cargo.toml')) {
    stats.detectedStack.push('Rust');
  }

  // Java Stack
  if (keyFilesSet.has('pom.xml') || keyFilesSet.has('build.gradle')) {
    stats.detectedStack.push('Java');
  }

  // PHP Stack
  if (keyFilesSet.has('composer.json')) {
    stats.detectedStack.push('PHP');
    try {
      const comp = JSON.parse(fs.readFileSync(path.join(targetDir, 'composer.json'), 'utf-8'));
      if (comp.require?.['laravel/framework']) stats.detectedStack.push('Laravel');
    } catch (e) {}
  }

  // Ruby Stack
  if (keyFilesSet.has('Gemfile')) {
    stats.detectedStack.push('Ruby');
  }

  // Containerization
  if (keyFilesSet.has('Dockerfile')) {
    stats.detectedStack.push('Docker');
  }
  if (keyFilesSet.has('docker-compose.yml') || keyFilesSet.has('docker-compose.yaml')) {
    stats.detectedStack.push('Docker Compose');
  }

  // Fallbacks
  if (stats.detectedStack.length === 0) {
    if (stats.fileTypes['.html']) stats.detectedStack.push('Static HTML/CSS/JS');
    else stats.detectedStack.push('Generic Codebase');
  }

  return stats;
}

module.exports = { scanStructure };
