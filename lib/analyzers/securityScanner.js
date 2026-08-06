const fs = require('fs');
const path = require('path');

const SECRET_PATTERNS = [
  { name: 'AWS Access Key ID', regex: /\b(AKIA|ASCA|ASIA)[0-9A-Z]{16}\b/g },
  { name: 'AWS Secret Access Key', regex: /\baws_secret_access_key\s*=\s*['"]([A-Za-z0-9/+=]{40})['"]/gi },
  { name: 'Generic API Key / Token', regex: /\b(api_key|apikey|secret_key|auth_token|access_token|client_secret)\s*[:=]\s*['"]([A-Za-z0-9_\-\.]{16,})['"]/gi },
  { name: 'OpenAI API Key', regex: /\bsk-[A-Za-z0-9]{32,48}\b/g },
  { name: 'GitHub Personal Access Token', regex: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b/g },
  { name: 'GitHub OAuth Client Secret', regex: /\bghs_[a-zA-Z0-9]{36,255}\b/g },
  { name: 'Slack Webhook URL', regex: /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9_]+\/B[A-Z0-9_]+\/[A-Za-z0-9_]+/g },
  { name: 'Stripe API Key', regex: /\brk_(live|test)_[0-9a-zA-Z]{24,99}\b/g },
  { name: 'Stripe Secret Key', regex: /\bsk_(live|test)_[0-9a-zA-Z]{24,99}\b/g },
  { name: 'RSA / SSH Private Key', regex: /-----BEGIN\s+(RSA|OPENSSH|EC|DSA|PGP|PRIVATE)\s+KEY-----/g },
  { name: 'Database Connection String with Password', regex: /\b(mongodb(?:\+srv)?|postgresql|postgres|mysql|redis):\/\/[^:]+:([^@]+)@/gi },
  { name: 'Google Cloud Platform API Key', regex: /\bAIza[0-9A-Za-z-_]{35}\b/g },
  { name: 'Mailgun API Key', regex: /\bkey-[0-9a-zA-Z]{32}\b/g },
  { name: 'JWT Secret Signature Key', regex: /\b(jwt_secret|jwtsecret|jwt_key|jwtkey)\s*[:=]\s*['"]([a-zA-Z0-9_-]{12,})['"]/gi },
  { name: 'Heroku API Key', regex: /\b[hH]eroku[a-zA-Z0-9_-]*['"]?\s*[:=]\s*['"]?[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}['"]?/g }
];

const SECURITY_FILE_EXTENSIONS = new Set([
  '.key', '.pem', '.crt', '.p12', '.pfx', '.pkcs12', '.der', '.asc'
]);

const SCAN_EXTENSIONS = new Set([
  '.js', '.ts', '.jsx', '.tsx', '.py', '.json', '.yaml', '.yml', '.env', '.md', '.txt', 
  '.go', '.rs', '.java', '.cs', '.php', '.rb', '.sh', '.ps1', '.html', '.config'
]);

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt', 'coverage', 
  'venv', '.venv', 'env', 'target', 'vendor', '.idea', '.vscode'
]);

function scanSecurity(targetDir, structureStats) {
  const security = {
    leakedSecrets: [],
    committedCerts: [],
    envIssues: [],
    issues: []
  };

  const keyFiles = new Set(structureStats.keyFiles);

  function addIssue(type, category, message) {
    security.issues.push({ type, category, message });
  }

  // 1. Audit .env files and .gitignore rules
  const hasEnv = fs.existsSync(path.join(targetDir, '.env'));
  const hasEnvExample = fs.existsSync(path.join(targetDir, '.env.example')) || fs.existsSync(path.join(targetDir, '.env.sample'));
  const gitignorePath = path.join(targetDir, '.gitignore');

  let isEnvIgnored = false;
  if (fs.existsSync(gitignorePath)) {
    try {
      const gitignoreContent = fs.readFileSync(gitignorePath, 'utf-8');
      const lines = gitignoreContent.split(/\r?\n/).map(l => l.trim());
      isEnvIgnored = lines.some(line => line === '.env' || line === '*.env' || line.includes('.env'));
    } catch (e) {}
  }

  if (hasEnv) {
    if (!isEnvIgnored) {
      addIssue('CRITICAL', 'Security', '`.env` file exists in project root but is NOT ignored in `.gitignore`. It is highly vulnerable to being leaked to version control.');
    } else {
      addIssue('PASS', 'Security', '`.env` file is present locally and correctly excluded in `.gitignore`.');
    }
  }

  if (hasEnv && !hasEnvExample) {
    addIssue('WARNING', 'Security', '`.env` file exists, but no `.env.example` boilerplate was found. Collaborative teams or CI build steps lack required environment blueprints.');
  } else if (hasEnvExample) {
    addIssue('PASS', 'Security', '`.env.example` blueprint is present to document required environment configurations.');
  }

  // 2. Scan project recursively for secret leaks and certificates
  function scanFile(filePath, relativePath) {
    const filename = path.basename(filePath);
    const ext = path.extname(filePath).toLowerCase();

    // Check if committed private key/cert file
    if (SECURITY_FILE_EXTENSIONS.has(ext)) {
      security.committedCerts.push(relativePath);
      addIssue('CRITICAL', 'Security', `Sensitive key/certificate file committed to version control: "${relativePath}". These must be kept out of repository source.`);
      return;
    }

    if (!SCAN_EXTENSIONS.has(ext) && filename !== '.env') return;

    try {
      const stat = fs.statSync(filePath);
      if (stat.size > 800000) return; // Skip large files > 800KB

      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split(/\r?\n/);

      SECRET_PATTERNS.forEach(pattern => {
        lines.forEach((line, index) => {
          // Skip placeholder and example keys
          const cleanLine = line.toLowerCase();
          if (
            cleanLine.includes('example') || 
            cleanLine.includes('your_key_here') || 
            cleanLine.includes('placeholder') || 
            cleanLine.includes('mock') || 
            cleanLine.includes('test_key') || 
            cleanLine.includes('sample_key') ||
            cleanLine.includes('<insert') ||
            cleanLine.includes('//') && cleanLine.indexOf(pattern.name.toLowerCase()) > cleanLine.indexOf('//') // comments referencing the key type
          ) {
            return;
          }

          pattern.regex.lastIndex = 0;
          if (pattern.regex.test(line)) {
            security.leakedSecrets.push({
              file: relativePath.replace(/\\/g, '/'),
              line: index + 1,
              secretType: pattern.name,
              snippet: line.trim().substring(0, 50) + '...'
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
      if (IGNORE_DIRS.has(entry.name)) continue;
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
    const totalLeaked = security.leakedSecrets.length;
    addIssue('CRITICAL', 'Security', `Detected ${totalLeaked} potential hardcoded credential leak(s) in source code files. Inspect these immediately to prevent security breaches.`);
  } else {
    addIssue('PASS', 'Security', 'No hardcoded credentials, secret keys, or private certificates detected in codebase source files.');
  }

  return security;
}

module.exports = { scanSecurity };
