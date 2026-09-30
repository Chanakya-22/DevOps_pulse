const fs = require('fs');
const path = require('path');
const { APPLICATION_STATE_PATHS } = require('./applicationState');

const GENERATED_DIRECTORIES = new Set([
  '.git',
  'bin',
  'node_modules',
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
  'obj',
  'out',
  'cache',
  '.cache',
  'tmp',
  'temp'
]);

function isWindowsAbsolutePath(value) {
  return /^[a-zA-Z]:[\\/]/.test(value) || /^\\\\[^\\]/.test(value) || /^\/\/[^/]/.test(value);
}

function createRepositoryBoundary(repositoryRoot, options = {}) {
  if (typeof repositoryRoot !== 'string' || repositoryRoot.length === 0) {
    throw new TypeError('repositoryRoot must be a non-empty path string');
  }

  const windowsPaths = isWindowsAbsolutePath(repositoryRoot);
  const pathApi = windowsPaths ? path.win32 : path;
  const normalizedRepositoryRoot = windowsPaths
    ? path.win32.resolve(repositoryRoot)
    : path.resolve(repositoryRoot);
  const configuredStatePaths = options.applicationStatePaths || APPLICATION_STATE_PATHS;
  const ignoredNames = new Set(GENERATED_DIRECTORIES);
  const gitignorePath = pathApi.join(normalizedRepositoryRoot, '.gitignore');

  try {
    const content = fs.readFileSync(gitignorePath, 'utf-8');
    content.split(/\r?\n/).forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const clean = trimmed.replace(/^\//, '').replace(/\/$/, '').replace(/\/\*$/, '');
        if (clean && clean !== '.gitignore') ignoredNames.add(clean);
      }
    });
  } catch (e) {}

  function resolvePath(pathValue) {
    if (typeof pathValue !== 'string' || pathValue.length === 0) {
      throw new TypeError('path must be a non-empty path string');
    }

    if (isWindowsAbsolutePath(pathValue)) {
      return path.win32.resolve(pathValue);
    }

    if (windowsPaths) {
      return path.win32.resolve(normalizedRepositoryRoot, pathValue);
    }

    return path.resolve(normalizedRepositoryRoot, pathValue.replace(/\\/g, path.sep));
  }

  function getRelativePath(pathValue) {
    const absolutePath = resolvePath(pathValue);
    if (isWindowsAbsolutePath(absolutePath) !== windowsPaths) {
      return null;
    }

    const relative = pathApi.relative(normalizedRepositoryRoot, absolutePath);
    if (pathApi.isAbsolute(relative)) {
      return null;
    }
    return relative.split(pathApi.sep).join('/');
  }

  function pathsEqual(firstPath, secondPath) {
    const first = pathApi.normalize(firstPath);
    const second = pathApi.normalize(secondPath);
    return windowsPaths
      ? first.toLowerCase() === second.toLowerCase()
      : first === second;
  }

  function isInsideRepository(pathValue) {
    const relative = getRelativePath(pathValue);
    return relative !== null && (
      relative === '' ||
      (relative !== '..' && !relative.startsWith('../'))
    );
  }

  function isApplicationStatePath(pathValue) {
    const absolutePath = resolvePath(pathValue);
    return configuredStatePaths.some(statePath => {
      if (typeof statePath !== 'string' || statePath.length === 0) {
        return false;
      }
      const resolvedStatePath = resolvePath(statePath);
      if (isWindowsAbsolutePath(absolutePath) !== isWindowsAbsolutePath(resolvedStatePath)) {
        return false;
      }
      return pathsEqual(absolutePath, resolvedStatePath);
    });
  }

  function isKnownGeneratedDirectory(pathValue) {
    if (!isInsideRepository(pathValue)) {
      return false;
    }

    const relative = getRelativePath(pathValue);
    const segments = relative.split('/').filter(Boolean);
    return segments.some(segment => GENERATED_DIRECTORIES.has(segment.toLowerCase()));
  }

  function isIgnoredByRepositoryRules(pathValue) {
    const relative = getRelativePath(pathValue);
    if (relative === null || relative === '') {
      return false;
    }
    return relative.split('/').some(segment => ignoredNames.has(segment));
  }

  function shouldExclude(pathValue) {
    return !isInsideRepository(pathValue) ||
      isApplicationStatePath(pathValue) ||
      isKnownGeneratedDirectory(pathValue) ||
      isIgnoredByRepositoryRules(pathValue);
  }

  return {
    repositoryRoot: normalizedRepositoryRoot,
    resolvePath,
    relativePath: getRelativePath,
    isInsideRepository,
    isApplicationStatePath,
    isKnownGeneratedDirectory,
    isIgnoredByRepositoryRules,
    shouldExclude
  };
}

module.exports = { createRepositoryBoundary };