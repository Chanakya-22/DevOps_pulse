const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { AUDIT_HISTORY_PATH } = require('../lib/engine/applicationState');
const { createRepositoryBoundary } = require('../lib/engine/repositoryBoundary');

test('resolves the repository root to an absolute normalized path', () => {
  const boundary = createRepositoryBoundary(path.join('workspace', 'repo'));

  assert.equal(boundary.repositoryRoot, path.resolve('workspace', 'repo'));
});

test('normalizes relative paths consistently across separator styles', () => {
  const boundary = createRepositoryBoundary(path.resolve('workspace', 'repo'));

  assert.equal(boundary.resolvePath('src\\modules/../index.js'), path.join(boundary.repositoryRoot, 'src', 'index.js'));
  assert.equal(boundary.relativePath('src\\modules/../index.js'), 'src/index.js');
});

test('handles Windows drive paths independently of the host platform', () => {
  const boundary = createRepositoryBoundary('C:\\workspace\\repo');

  assert.equal(boundary.repositoryRoot, 'C:\\workspace\\repo');
  assert.equal(boundary.resolvePath('src\\..\\app.js'), 'C:\\workspace\\repo\\app.js');
  assert.equal(boundary.relativePath('C:\\workspace\\repo\\src\\app.js'), 'src/app.js');
  assert.equal(boundary.isInsideRepository('c:\\WORKSPACE\\REPO\\src\\app.js'), true);
  assert.equal(boundary.isInsideRepository('C:\\other\\app.js'), false);
});

test('identifies the canonical application history path without excluding data generally', () => {
  const repositoryRoot = path.resolve(__dirname, '..');
  const boundary = createRepositoryBoundary(repositoryRoot);

  assert.equal(AUDIT_HISTORY_PATH, path.join(repositoryRoot, 'data', 'history.json'));
  assert.equal(boundary.isApplicationStatePath('data/history.json'), true);
  assert.equal(boundary.shouldExclude('data/history.json'), true);
  assert.equal(boundary.isKnownGeneratedDirectory('data/source.csv'), false);
  assert.equal(boundary.shouldExclude('data/source.csv'), false);
});

test('distinguishes paths outside the repository', () => {
  const boundary = createRepositoryBoundary(path.resolve('workspace', 'repo'));
  const outsidePath = path.resolve('workspace', 'other', 'file.js');

  assert.equal(boundary.isInsideRepository(outsidePath), false);
  assert.equal(boundary.relativePath(outsidePath), '../other/file.js');
  assert.equal(boundary.shouldExclude(outsidePath), true);
});

test('recognizes known generated directories by path segment', () => {
  const boundary = createRepositoryBoundary(path.resolve('workspace', 'repo'));

  assert.equal(boundary.isKnownGeneratedDirectory('packages/app/node_modules/pkg/index.js'), true);
  assert.equal(boundary.isKnownGeneratedDirectory('src/buildConfig.js'), false);
});