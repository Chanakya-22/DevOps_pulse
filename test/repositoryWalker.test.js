const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createRepositoryBoundary } = require('../lib/engine/repositoryBoundary');
const { createRepositoryInventory } = require('../lib/engine/repositoryWalker');
const { scanStructure } = require('../lib/analyzers/structureScanner');

function createTempDirectory(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFile(root, relativePath, content = '') {
  const filePath = path.join(root, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

function createBoundary(root, historyPath = path.join(root, 'data', 'history.json')) {
  return createRepositoryBoundary(root, { applicationStatePaths: [historyPath] });
}

test('inventories normalized in-scope files and excludes explicit state and generated directories', () => {
  const root = createTempDirectory('devops-pulse-inventory-');
  try {
    writeFile(root, 'src/app.js', 'const app = true;\n');
    writeFile(root, 'data/source.csv', 'id,value\n');
    writeFile(root, 'data/history.json', '[]\n');
    writeFile(root, 'node_modules/example/index.js', 'module.exports = true;\n');

    const boundary = createBoundary(root);
    const inventory = createRepositoryInventory(boundary);
    const relativePaths = inventory.files.map(file => file.relativePath);
    const appFile = inventory.files.find(file => file.relativePath === 'src/app.js');

    assert.equal(inventory.repositoryRoot, path.resolve(root));
    assert.ok(relativePaths.includes('src/app.js'));
    assert.ok(relativePaths.includes('data/source.csv'));
    assert.ok(!relativePaths.includes('data/history.json'));
    assert.ok(!relativePaths.some(file => file.startsWith('node_modules/')));
    assert.equal(appFile.absolutePath, path.join(root, 'src', 'app.js'));
    assert.equal(appFile.fileName, 'app.js');
    assert.equal(appFile.extension, '.js');
    assert.equal(appFile.size, Buffer.byteLength('const app = true;\n'));
    assert.ok(inventory.directories.some(directory => directory.relativePath === 'src'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('preserves the existing simplified root gitignore interpretation', () => {
  const root = createTempDirectory('devops-pulse-gitignore-');
  try {
    writeFile(root, '.gitignore', '/ignored.txt\nignored-dir/\n');
    writeFile(root, 'keep.js', '');
    writeFile(root, 'ignored.txt', '');
    writeFile(root, 'ignored-dir/generated.js', '');

    const inventory = createRepositoryInventory(createBoundary(root));
    const relativePaths = inventory.files.map(file => file.relativePath);

    assert.ok(relativePaths.includes('keep.js'));
    assert.ok(!relativePaths.includes('ignored.txt'));
    assert.ok(!relativePaths.includes('ignored-dir/generated.js'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('sorts inventory paths deterministically and returns equivalent repeated results', () => {
  const root = createTempDirectory('devops-pulse-order-');
  try {
    writeFile(root, 'z.js', '');
    writeFile(root, 'middle/nested.js', '');
    writeFile(root, 'a.js', '');

    const boundary = createBoundary(root);
    const first = createRepositoryInventory(boundary);
    const second = createRepositoryInventory(boundary);

    assert.deepEqual(first.files.map(file => file.relativePath), ['a.js', 'middle/nested.js', 'z.js']);
    assert.deepEqual(first.files, second.files);
    assert.deepEqual(first.directories, second.directories);
    assert.ok(first.files.every(file => !file.relativePath.includes('\\')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('does not inventory files outside the repository or follow directory symlinks', t => {
  const parent = createTempDirectory('devops-pulse-boundary-');
  const root = path.join(parent, 'repo');
  const outside = path.join(parent, 'outside');
  fs.mkdirSync(root);
  fs.mkdirSync(outside);
  try {
    writeFile(root, 'inside.js', '');
    writeFile(outside, 'outside.js', '');

    try {
      fs.symlinkSync(outside, path.join(root, 'linked-outside'), 'junction');
    } catch (error) {
      t.skip(`directory symlink creation unavailable: ${error.code || error.message}`);
      return;
    }

    const inventory = createRepositoryInventory(createBoundary(root));
    const absolutePaths = inventory.files.map(file => file.absolutePath);

    assert.ok(absolutePaths.includes(path.join(root, 'inside.js')));
    assert.ok(!absolutePaths.includes(path.join(outside, 'outside.js')));
    assert.ok(!inventory.files.some(file => file.relativePath.startsWith('linked-outside/')));
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('structure scanner derives compatible statistics from a supplied inventory', () => {
  const root = createTempDirectory('devops-pulse-structure-');
  try {
    writeFile(root, 'package.json', JSON.stringify({ name: 'fixture', dependencies: { express: '1.0.0' } }));
    writeFile(root, 'package-lock.json', '{}');
    writeFile(root, 'README.md', '# Fixture\n');
    writeFile(root, 'src/index.js', 'module.exports = true;\n');
    writeFile(root, 'data/history.json', '[]\n');

    const inventory = createRepositoryInventory(createBoundary(root));
    const stats = scanStructure(root, inventory);

    assert.equal(stats.totalFiles, 4);
    assert.equal(stats.totalDirs, 2);
    assert.equal(stats.totalLinesOfCode, 2);
    assert.deepEqual(stats.detectedStack, ['Node.js / JavaScript / TypeScript', 'Express']);
    assert.deepEqual(stats.keyFiles, ['README.md', 'package-lock.json', 'package.json']);
    assert.ok(stats.structureTree.some(entry => entry.path === 'src' && entry.type === 'dir'));
    assert.ok(stats.structureTree.some(entry => entry.path === 'src/index.js' && entry.type === 'file'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('preserves core structure statistics for the DevOps Pulse repository', () => {
  const repositoryRoot = path.resolve(__dirname, '..');
  const inventory = createRepositoryInventory(createRepositoryBoundary(repositoryRoot));
  const stats = scanStructure(repositoryRoot, inventory);

  assert.equal(stats.totalFiles, 26);
  assert.equal(stats.totalDirs, 9);
  assert.ok(stats.totalLinesOfCode >= 3969);
  assert.deepEqual(stats.detectedStack, [
    'Node.js / JavaScript / TypeScript',
    'Express',
    'Docker'
  ]);
  assert.deepEqual(new Set(stats.keyFiles), new Set([
    '.dockerignore',
    '.github/workflows/ci.yml',
    '.gitignore',
    'Dockerfile',
    'LICENSE',
    'package-lock.json',
    'package.json',
    'README.md'
  ]));
  assert.ok(!inventory.files.some(file => file.relativePath === 'data/history.json'));
});