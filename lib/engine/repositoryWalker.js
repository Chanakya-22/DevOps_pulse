const fs = require('fs');
const path = require('path');

function comparePaths(first, second) {
  if (first < second) return -1;
  if (first > second) return 1;
  return 0;
}

function isInsideRealRoot(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  return relative === '' || (
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function createRepositoryInventory(boundary) {
  if (
    !boundary ||
    typeof boundary.resolvePath !== 'function' ||
    typeof boundary.relativePath !== 'function' ||
    typeof boundary.isInsideRepository !== 'function' ||
    typeof boundary.shouldExclude !== 'function'
  ) {
    throw new TypeError('A repository boundary created by createRepositoryBoundary is required');
  }

  const repositoryRoot = boundary.repositoryRoot;
  const realRepositoryRoot = fs.realpathSync(repositoryRoot);
  const files = [];
  const directories = [];
  const pendingDirectories = [{ absolutePath: repositoryRoot, relativePath: '', depth: 0 }];

  while (pendingDirectories.length > 0) {
    const current = pendingDirectories.pop();
    let entries;
    try {
      entries = fs.readdirSync(current.absolutePath, { withFileTypes: true });
    } catch (e) {
      continue;
    }

    entries.forEach(entry => {
      const relativePath = current.relativePath
        ? `${current.relativePath}/${entry.name}`
        : entry.name;
      const absolutePath = boundary.resolvePath(relativePath);

      if (!boundary.isInsideRepository(absolutePath) || boundary.shouldExclude(absolutePath)) {
        return;
      }

      if (entry.isSymbolicLink()) {
        return;
      }

      let stat;
      try {
        stat = fs.lstatSync(absolutePath);
      } catch (e) {
        return;
      }

      if (stat.isSymbolicLink()) {
        return;
      }

      if (entry.isDirectory() && stat.isDirectory()) {
        let realPath;
        try {
          realPath = fs.realpathSync(absolutePath);
        } catch (e) {
          return;
        }
        if (!isInsideRealRoot(realRepositoryRoot, realPath)) {
          return;
        }

        directories.push({
          absolutePath,
          relativePath,
          directoryName: entry.name,
          depth: current.depth
        });
        pendingDirectories.push({
          absolutePath,
          relativePath,
          depth: current.depth + 1
        });
      } else if (entry.isFile() && stat.isFile()) {
        files.push({
          absolutePath,
          relativePath,
          fileName: entry.name,
          extension: path.extname(entry.name).toLowerCase(),
          size: stat.size,
          depth: current.depth
        });
      }
    });
  }

  files.sort((first, second) => comparePaths(first.relativePath, second.relativePath));
  directories.sort((first, second) => comparePaths(first.relativePath, second.relativePath));

  return {
    repositoryRoot,
    files,
    directories
  };
}

module.exports = { createRepositoryInventory };