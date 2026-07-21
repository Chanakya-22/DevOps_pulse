const fs = require('fs');
const path = require('path');

/**
 * Generates tailored GitHub Actions workflow
 */
function generateGitHubWorkflow(stack) {
  const isNode = stack.some(s => s.toLowerCase().includes('node') || s.toLowerCase().includes('react') || s.toLowerCase().includes('vue'));
  const isPython = stack.some(s => s.toLowerCase().includes('python'));
  const isGo = stack.some(s => s.toLowerCase().includes('go'));
  const isRust = stack.some(s => s.toLowerCase().includes('rust'));

  if (isPython) {
    return `name: CI Pipeline

on:
  push:
    branches: [ main, master, dev ]
  pull_request:
    branches: [ main, master ]

jobs:
  build-and-test:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout Code
        uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'
          cache: 'pip'

      - name: Install Dependencies
        run: |
          python -m pip install --upgrade pip
          if [ -f requirements.txt ]; then pip install -r requirements.txt; fi

      - name: Run Tests
        run: |
          python -m unittest discover || pytest || echo "No tests run"
`;
  }

  if (isGo) {
    return `name: CI Pipeline

on:
  push:
    branches: [ main, master ]
  pull_request:
    branches: [ main, master ]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Setup Go
        uses: actions/setup-go@v5
        with:
          go-version: '1.22'
      - name: Install dependencies
        run: go get -v ./...
      - name: Build
        run: go build -v ./...
      - name: Test
        run: go test -v ./...
`;
  }

  if (isRust) {
    return `name: CI Pipeline

on:
  push:
    branches: [ main, master ]
  pull_request:
    branches: [ main, master ]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Setup Rust
        uses: dtolnay/rust-toolchain@stable
      - name: Build
        run: cargo build --verbose
      - name: Run Tests
        run: cargo test --verbose
`;
  }

  // Default Node.js / Universal workflow
  return `name: CI/CD Pipeline

on:
  push:
    branches: [ main, master, develop ]
  pull_request:
    branches: [ main, master ]

jobs:
  audit-and-test:
    name: Build & Test
    runs-on: ubuntu-latest

    strategy:
      matrix:
        node-version: [18.x, 20.x]

    steps:
      - name: Checkout Source Code
        uses: actions/checkout@v4

      - name: Setup Node.js \${{ matrix.node-version }}
        uses: actions/setup-node@v4
        with:
          node-version: \${{ matrix.node-version }}
          cache: 'npm'

      - name: Install Dependencies
        run: npm ci || npm install

      - name: Code Quality & Lint
        run: npm run lint --if-present

      - name: Execute Tests
        run: npm test --if-present

      - name: Build Artifacts
        run: npm run build --if-present
`;
}

/**
 * Generates Dockerfile based on stack
 */
function generateDockerfile(stack) {
  const isPython = stack.some(s => s.toLowerCase().includes('python'));
  const isNext = stack.some(s => s.toLowerCase().includes('next'));

  if (isPython) {
    return `# Dockerfile for Python Application
FROM python:3.11-slim as base

WORKDIR /app

# Prevent Python from writing pyc files and buffering stdout/stderr
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000
CMD ["python", "main.py"]
`;
  }

  if (isNext) {
    return `# Multi-stage Dockerfile for Next.js
FROM node:20-alpine AS base

# 1. Install dependencies
FROM base AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

# 2. Rebuild source code
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# 3. Production runner
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000
ENV PORT=3000
CMD ["node", "server.js"]
`;
  }

  // Node.js Express / App default Dockerfile
  return `# Production Multi-Stage Dockerfile
FROM node:20-alpine AS dependencies
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=dependencies /app/node_modules ./node_modules
COPY . .

EXPOSE 3000
USER node
CMD ["npm", "start"]
`;
}

/**
 * Generates .dockerignore
 */
function generateDockerIgnore() {
  return `node_modules
.git
.gitignore
Dockerfile
.dockerignore
npm-debug.log*
yarn-debug.log*
yarn-error.log*
.next
.nuxt
dist
build
coverage
.env
.env.local
.env.*.local
`;
}

/**
 * Generates standard .gitignore
 */
function generateGitIgnore(stack) {
  let content = `# Dependency directories
node_modules/
jspm_packages/

# Environment files
.env
.env.local
.env.development.local
.env.test.local
.env.production.local

# Logs
logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Build outputs
dist/
build/
.next/
out/
coverage/

# OS and Editor files
.DS_Store
Thumbs.db
.idea/
.vscode/
*.swp
*.swo
`;

  if (stack.some(s => s.toLowerCase().includes('python'))) {
    content += `
# Python
__pycache__/
*.py[cod]
*$py.class
venv/
.venv/
env/
.pytest_cache/
`;
  }

  return content;
}

/**
 * Generates .env.example from existing .env
 */
function generateEnvExample(targetDir) {
  const envPath = path.join(targetDir, '.env');
  if (fs.existsSync(envPath)) {
    try {
      const raw = fs.readFileSync(envPath, 'utf-8');
      const lines = raw.split(/\r?\n/).map(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return line;
        const eqIndex = trimmed.indexOf('=');
        if (eqIndex !== -1) {
          const key = trimmed.substring(0, eqIndex);
          return `${key}=your_${key.toLowerCase()}_here`;
        }
        return line;
      });
      return lines.join('\n');
    } catch (e) {}
  }

  return `# Environment Blueprint Template
PORT=3000
NODE_ENV=development
DATABASE_URL=postgresql://user:password@localhost:5432/mydb
API_KEY=your_api_key_here
`;
}

module.exports = {
  generateGitHubWorkflow,
  generateDockerfile,
  generateDockerIgnore,
  generateGitIgnore,
  generateEnvExample
};
