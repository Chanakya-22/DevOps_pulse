const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createRepositoryBoundary } = require('../lib/engine/repositoryBoundary');
const { createRepositoryInventory } = require('../lib/engine/repositoryWalker');
const { scanSecurity } = require('../lib/analyzers/securityScanner');

function createTempDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'devops-pulse-security-'));
}

function writeFile(root, relativePath, content) {
  const filePath = path.join(root, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

function createInventory(root) {
  const historyPath = path.join(root, 'data', 'history.json');
  const boundary = createRepositoryBoundary(root, { applicationStatePaths: [historyPath] });
  return createRepositoryInventory(boundary);
}

function emptyStructure() {
  return { keyFiles: [] };
}

test('excludes generated audit history while keeping an in-scope secret finding stable', () => {
  const root = createTempDirectory();
  const sourceSecretPrefix = 'const DATABASE_URL = "postgresql://testuser:';
  const sourceSecretSuffix = 'testpassword@localhost/testdb";';
  const sourceSecret = sourceSecretPrefix + sourceSecretSuffix;
  try {
    writeFile(root, 'src/config.js', `${sourceSecret}\n`);
    writeFile(root, 'data/history.json', '[]\n');

    const firstInventory = createInventory(root);
    const first = scanSecurity(root, emptyStructure(), firstInventory);
    const repeated = scanSecurity(root, emptyStructure(), firstInventory);

    assert.ok(firstInventory.files.some(file => file.relativePath === 'src/config.js'));
    assert.ok(!firstInventory.files.some(file => file.relativePath === 'data/history.json'));
    assert.deepEqual(first, repeated);
    assert.equal(first.leakedSecrets.length, 1);
    assert.deepEqual(first.leakedSecrets[0], {
      file: 'src/config.js',
      line: 1,
      secretType: 'Database Connection String with Password',
      snippet: `${sourceSecret.substring(0, 50)}...`
    });

    writeFile(root, 'data/history.json', JSON.stringify({ fullData: first }));
    const secondInventory = createInventory(root);
    const second = scanSecurity(root, emptyStructure(), secondInventory);

    assert.ok(!secondInventory.files.some(file => file.relativePath === 'data/history.json'));
    assert.deepEqual(second.leakedSecrets, first.leakedSecrets);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('continues scanning every existing supported extension', () => {
  const root = createTempDirectory();
  const extensions = [
    '.js', '.ts', '.jsx', '.tsx', '.py', '.json', '.yaml', '.yml', '.env',
    '.md', '.txt', '.go', '.rs', '.java', '.cs', '.php', '.rb', '.sh', '.ps1',
    '.html', '.config'
  ];
  const apiKeyContent = ['api_key = "', 'abcdefghijkl', 'mnop', '"'].join('');
  try {
    extensions.forEach(extension => writeFile(root, `source${extension}`, apiKeyContent));

    const inventory = createInventory(root);
    const security = scanSecurity(root, emptyStructure(), inventory);

    assert.deepEqual(
      new Set(security.leakedSecrets.map(finding => finding.file)),
      new Set(extensions.map(extension => `source${extension}`))
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('preserves the existing large-file limit and placeholder heuristics', () => {
  const root = createTempDirectory();
  const apiKeyContent = ['api_key = "', 'abcdefghijkl', 'mnop', '"'].join('');
  try {
    writeFile(root, 'large.js', `${' '.repeat(800001)}${apiKeyContent}`);
    writeFile(root, 'placeholder.js', `${apiKeyContent} // example placeholder`);
    writeFile(root, 'active.js', apiKeyContent);

    const security = scanSecurity(root, emptyStructure(), createInventory(root));

    assert.deepEqual(security.leakedSecrets.map(finding => finding.file), ['active.js']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('retains the existing finding shape and skips the specified example.com placeholder line', () => {
  const root = createTempDirectory();
  const exampleUrlPrefix = 'const DATABASE_URL = "postgresql://testuser:';
  const exampleUrlSuffix = 'testpassword@example.com/testdb";';
  try {
    writeFile(root, 'source.js', exampleUrlPrefix + exampleUrlSuffix);

    const security = scanSecurity(root, emptyStructure(), createInventory(root));

    assert.deepEqual(security.leakedSecrets, []);
    assert.deepEqual(Object.keys(security), ['leakedSecrets', 'committedCerts', 'envIssues', 'issues']);
    assert.deepEqual(security.issues.at(-1), {
      type: 'PASS',
      category: 'Security',
      message: 'No hardcoded credentials, secret keys, or private certificates detected in codebase source files.'
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('consumes inventory records without independently enumerating directories', () => {
  const root = createTempDirectory();
  try {
    writeFile(root, 'source.js', ['api_key = "', 'abcdefghijkl', 'mnop', '"'].join(''));
    const inventory = createInventory(root);
    const originalReaddirSync = fs.readdirSync;

    fs.readdirSync = () => {
      throw new Error('security scanner must not enumerate directories');
    };
    try {
      const security = scanSecurity(root, emptyStructure(), inventory);
      assert.equal(security.leakedSecrets.length, 1);
    } finally {
      fs.readdirSync = originalReaddirSync;
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});