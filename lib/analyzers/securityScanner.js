const fs = require('fs');
const path = require('path');

const SECRET_PATTERNS = [
  { name: 'AWS Access Key ID', regex: /AKIA[0-9A-Z]{16}/g },
  { name: 'AWS Secret Access Key', regex: /aws_secret_access_key\s*=\s*['"][A-Za-z0-9/+=]{40}['"]/gi },
  { name: 'Generic API Key / Token', regex: /(api_key|apikey|secret_key|auth_token|access_token)\s*[:=]\s*['"][A-Za-z0-9_\-]{20,}['"]/gi },
  { name: 'OpenAI API Key', regex: /sk-[A-Za-z0-9]{32,48}/g },
  { name: 'GitHub Personal Access Token', regex: /ghp_[A-Za-z0-9]{36}/g },
  { name: 'RSA / Private Key', regex: /-----BEGIN (RSA|OPENSSH|EC|PRIVATE) KEY-----/g },
  { name: 'Hardcoded Database URI with Password', regex: /mongodb(?:\+srv)?:\/\/[^:]+:([^@]+)@/gi }
];

const SCAN_EXTENSIONS = new Set(['.js', '.ts', '.jsx', '.tsx', '.py', '.json', '.yaml', '.yml', '.env', '.md', '.txt', '.go', '.rs', '.java', '.html']);

function scanSecurity(targetDir, structureStats) {
  const security = {
    leakedSecrets: [],
    envIssues: [],
    issues: []
  };

  const keyFiles = new Set(structureStats.keyFiles);

  // 1. Check .env and .gitignore
  const hasEnv = fs.existsSync(path.join(targetDir, '.env'));
  const hasEnvExample = fs.existsSync(path.join(targetDir, '.env.example')) || fs.existsSync(path.join(targetDir, '.env.sample'));
  const gitignorePath = path.join(targetDir, '.gitignore');

  let isEnvIgnored = false;
  if (fs.existsSync(gitignorePath)) {
    try {
      const gitignoreContent = fs.readFileSync(gitignorePath, 'utf-8');
      isEnvIgnored = gitignoreContent.split(/\r?\n/).some(line => line.trim() === '.env' || line.trim() === '*.env');
    } catch (e) {}
  }

  if (hasEnv) {
    if (!isEnvIgnored) {
      security.issues.push({
        type: 'CRITICAL',
        category: 'Security',
        message: '`.env` file exists in project root but is NOT listed in `.gitignore`! It risks being committed to version control.'
      });
    } else {
      security.issues.push({
        type: 'INFO',
        category: 'Security',
        message: '`.env` file is properly ignored in `.gitignore`.'
      });
    }
  }

  if (hasEnv && !hasEnvExample) {
    security.issues.push({
      type: 'WARNING',
      category: 'Security',
      message: '`.env` file exists but no `.env.example` template was found. Team members or CI pipelines may lack required variable blueprints.'
    });
  }

  // 2. Scan code files for hardcoded secrets
  const ignores = new Set(['node_modules', '.git', 'dist', 'build', 'coverage']);

  function scanFile(filePath, relativePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (!SCAN_EXTENSIONS.has(ext) && path.basename(filePath) !== '.env') return;

    try {
      const stat = fs.statSync(filePath);
      if (stat.size > 500000) return; // Skip files > 500KB

      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split(/\r?\n/);

      SECRET_PATTERNS.forEach(pattern => {
        lines.forEach((line, index) => {
          if (line.includes('example') || line.includes('your_key_here') || line.includes('placeholder')) return;
          pattern.regex.lastIndex = 0;
          if (pattern.regex.test(line)) {
            security.leakedSecrets.push({
              file: relativePath.replace(/\\/g, '/'),
              line: index + 1,
              secretType: pattern.name,
              snippet: line.trim().substring(0, 60) + '...'
            });
          }
        });
      });
    } catch (e) {}
  }

  function traverse(currentDir, relativePath = '') {
    let entries = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch (e) {
      return;
    }

    for (const entry of entries) {
      if (ignores.has(entry.name)) continue;
      const fullPath = path.join(currentDir, entry.name);
      const relPath = relativePath ? path.join(relativePath, entry.name) : entry.name;

      if (entry.isDirectory()) {
        traverse(fullPath, relPath);
      } else if (entry.isFile()) {
        scanFile(fullPath, relPath);
      }
    }
  }

  traverse(targetDir);

  if (security.leakedSecrets.length > 0) {
    security.issues.push({
      type: 'CRITICAL',
      category: 'Security',
      message: `Detected ${security.leakedSecrets.length} potential hardcoded secret/API key(s) in project files!`
    });
  }

  return security;
}

module.exports = { scanSecurity };
