const fs = require('fs');
const path = require('path');

function checkCICD(targetDir, structureStats) {
  const cicd = {
    hasGitHubWorkflows: false,
    hasDockerfile: false,
    hasDockerIgnore: false,
    hasDockerCompose: false,
    hasReadme: false,
    hasLicense: false,
    hasGitignore: false,
    cicdProvider: null,
    issues: [],
    foundPipelines: [],
    details: {
      workflowAudits: [],
      dockerfileAudits: []
    },
    // CodeRabbit-style inline reviews
    annotatedFiles: {}
  };

  const keyFiles = new Set(structureStats.keyFiles);

  function addIssue(type, category, message) {
    cicd.issues.push({ type, category, message });
  }

  // 1. Audit CI/CD Workflows
  const githubDir = path.join(targetDir, '.github', 'workflows');
  if (fs.existsSync(githubDir)) {
    try {
      const files = fs.readdirSync(githubDir).filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));
      if (files.length > 0) {
        cicd.hasGitHubWorkflows = true;
        cicd.cicdProvider = 'GitHub Actions';
        
        files.forEach(file => {
          const relPath = `.github/workflows/${file}`;
          cicd.foundPipelines.push(relPath);
          auditGitHubWorkflow(path.join(githubDir, file), relPath, addIssue, cicd.details.workflowAudits, cicd.annotatedFiles);
        });
      }
    } catch (e) {}
  }

  if (keyFiles.has('.gitlab-ci.yml')) {
    cicd.cicdProvider = 'GitLab CI';
    cicd.foundPipelines.push('.gitlab-ci.yml');
    auditGitLabCI(path.join(targetDir, '.gitlab-ci.yml'), addIssue);
  }
  if (keyFiles.has('azure-pipelines.yml')) {
    cicd.cicdProvider = 'Azure Pipelines';
    cicd.foundPipelines.push('azure-pipelines.yml');
  }
  if (keyFiles.has('Jenkinsfile')) {
    cicd.cicdProvider = 'Jenkins';
    cicd.foundPipelines.push('Jenkinsfile');
  }
  if (keyFiles.has('.travis.yml')) {
    cicd.cicdProvider = 'Travis CI';
    cicd.foundPipelines.push('.travis.yml');
  }
  if (fs.existsSync(path.join(targetDir, '.circleci', 'config.yml'))) {
    cicd.cicdProvider = 'CircleCI';
    cicd.foundPipelines.push('.circleci/config.yml');
  }

  if (!cicd.cicdProvider) {
    addIssue('CRITICAL', 'CI/CD', 'No CI/CD pipeline configuration detected. Running builds and tests manually compromises shipment reliability and deployment quality.');
  } else {
    addIssue('PASS', 'CI/CD', `Detected CI/CD pipeline provider: ${cicd.cicdProvider} (${cicd.foundPipelines.length} configuration file(s) found).`);
  }

  // 2. Audit Docker Configuration
  if (keyFiles.has('Dockerfile')) {
    cicd.hasDockerfile = true;
    auditDockerfile(path.join(targetDir, 'Dockerfile'), addIssue, cicd.details.dockerfileAudits, cicd.annotatedFiles);

    if (!keyFiles.has('.dockerignore')) {
      addIssue('WARNING', 'Docker', 'Dockerfile exists but `.dockerignore` file is missing. The Docker build context will include node_modules, build logs, and secrets, bloat build sizes, and slow pipelines.');
    } else {
      cicd.hasDockerIgnore = true;
      auditDockerIgnore(path.join(targetDir, '.dockerignore'), addIssue);
    }
  } else {
    addIssue('INFO', 'Docker', 'No Dockerfile detected. Packaging the application as a Docker container is recommended for cloud-native deployment.');
  }

  if (keyFiles.has('docker-compose.yml') || keyFiles.has('docker-compose.yaml')) {
    cicd.hasDockerCompose = true;
  }

  // 3. Project Documentation and Repository Hygiene
  cicd.hasReadme = keyFiles.has('README.md') || fs.existsSync(path.join(targetDir, 'readme.md'));
  cicd.hasLicense = keyFiles.has('LICENSE') || fs.existsSync(path.join(targetDir, 'LICENSE.md')) || fs.existsSync(path.join(targetDir, 'LICENSE.txt'));
  cicd.hasGitignore = keyFiles.has('.gitignore');

  if (!cicd.hasReadme) {
    addIssue('WARNING', 'Documentation', 'Missing README.md. High-performing repositories should document quickstart steps, system configuration, and prerequisites.');
  } else {
    addIssue('PASS', 'Documentation', 'README.md exists for developer onboarding and documentation.');
  }

  if (!cicd.hasLicense) {
    addIssue('INFO', 'Documentation', 'No LICENSE file detected. Projects should include a license (e.g. MIT, Apache, Proprietary) to define legal terms of use.');
  }

  if (!cicd.hasGitignore) {
    addIssue('CRITICAL', 'Git', 'Missing `.gitignore` file. Artifacts, binary builds, and sensitive local secrets will pollute the source code control history.');
  } else {
    addIssue('PASS', 'Git', '`.gitignore` is present in the project root.');
  }

  return cicd;
}

/**
 * Detailed analysis of GitHub Workflow YAMLs with line-level annotations
 */
function auditGitHubWorkflow(filePath, relativePath, addIssue, auditList, annotatedFiles) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split(/\r?\n/);
    
    let usesUnpinnedAction = false;
    let missingCache = false;
    let usesNpmInstall = false;
    let hasHardcodedSecret = false;
    
    const annotations = [];

    // Simplistic line-by-line parsing for workflow patterns
    lines.forEach((line, idx) => {
      const trimmed = line.trim();
      const lineNum = idx + 1;

      // Check version pinning of actions
      if (trimmed.startsWith('uses:')) {
        const actionSpec = trimmed.replace('uses:', '').trim();
        // Skip local actions (starting with ./)
        if (!actionSpec.startsWith('./') && !actionSpec.startsWith('docker://')) {
          let isLoose = false;
          if (!actionSpec.includes('@')) {
            isLoose = true;
          } else {
            const version = actionSpec.split('@')[1];
            if (['main', 'master', 'latest', 'dev', 'develop'].includes(version.toLowerCase())) {
              isLoose = true;
            }
          }
          if (isLoose) {
            usesUnpinnedAction = true;
            annotations.push({
              line: lineNum,
              type: 'WARNING',
              category: 'CI/CD Version Pinning',
              message: `Loose action version referenced: "${actionSpec}"`,
              recommendation: 'Pin your actions to a release tag (like @v4) or a specific 40-character Git commit hash to protect against upstream code updates.'
            });
          }
        }
      }

      // Check npm install usage (npm ci is preferred in CI)
      if (trimmed.includes('npm install') || trimmed.includes('npm i ') || trimmed.endsWith('npm i')) {
        if (!trimmed.includes('--production') && !trimmed.includes('npm install -g')) {
          usesNpmInstall = true;
          annotations.push({
            line: lineNum,
            type: 'WARNING',
            category: 'CI/CD Script Safety',
            message: 'Running "npm install" inside CI/CD script is not recommended.',
            recommendation: 'Use "npm ci" instead. It is faster and guarantees clean, deterministic builds matching your package-lock.json exactly.'
          });
        }
      }

      // Check hardcoded passwords/secrets in env vars
      if (trimmed.includes('PASSWORD:') || trimmed.includes('TOKEN:') || trimmed.includes('SECRET:')) {
        const value = trimmed.split(':')[1]?.trim() || '';
        if (value && !value.includes('${{') && !value.startsWith('"your_') && !value.includes('placeholder')) {
          hasHardcodedSecret = true;
          annotations.push({
            line: lineNum,
            type: 'CRITICAL',
            category: 'Security Risk',
            message: `Hardcoded plain text environment secret detected.`,
            recommendation: 'Remove plain text secrets. Store them in GitHub Repository Secrets and reference them via "${{ secrets.SECRET_NAME }}".'
          });
        }
      }
    });

    // Check if workflow sets up Node or Python but lacks caching
    const lowerContent = content.toLowerCase();
    if (lowerContent.includes('actions/setup-node') && !lowerContent.includes('cache:')) {
      missingCache = true;
      const lineIdx = lines.findIndex(l => l.includes('actions/setup-node'));
      if (lineIdx !== -1) {
        annotations.push({
          line: lineIdx + 1,
          type: 'INFO',
          category: 'Performance Tuning',
          message: 'Node setup does not leverage caching.',
          recommendation: 'Add "with: { cache: \'npm\' }" (or yarn/pnpm equivalent) to speed up package setup times.'
        });
      }
    }
    if (lowerContent.includes('actions/setup-python') && !lowerContent.includes('cache:')) {
      missingCache = true;
      const lineIdx = lines.findIndex(l => l.includes('actions/setup-python'));
      if (lineIdx !== -1) {
        annotations.push({
          line: lineIdx + 1,
          type: 'INFO',
          category: 'Performance Tuning',
          message: 'Python setup does not leverage caching.',
          recommendation: 'Add "with: { cache: \'pip\' }" to speed up package setup times.'
        });
      }
    }

    const report = {
      file: relativePath,
      usesUnpinnedAction,
      missingCache,
      usesNpmInstall,
      hasHardcodedSecret
    };
    auditList.push(report);

    annotatedFiles[relativePath] = {
      content: content,
      annotations: annotations
    };

    if (usesUnpinnedAction) {
      addIssue('WARNING', 'CI/CD', `GitHub workflow "${relativePath}" references loose/unpinned action versions (e.g. @master, @main). Pin these to a tag or SHA to lock dependencies.`);
    }
    if (missingCache) {
      addIssue('INFO', 'CI/CD', `GitHub workflow "${relativePath}" installs packages without caching. Enabling actions caching (e.g., cache: 'npm') speeds up execution.`);
    }
    if (usesNpmInstall) {
      addIssue('WARNING', 'CI/CD', `GitHub workflow "${relativePath}" runs "npm install" instead of "npm ci". "npm ci" ensures clean, deterministic builds using package-lock.json.`);
    }
    if (hasHardcodedSecret) {
      addIssue('CRITICAL', 'Security', `GitHub workflow "${relativePath}" contains potential hardcoded secret environment variable. Use GitHub Secrets (\${{ secrets.VAR_NAME }}) instead.`);
    }

  } catch (e) {}
}

/**
 * Audit GitLab CI config
 */
function auditGitLabCI(filePath, addIssue) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    if (content.includes('npm install') && !content.includes('npm ci')) {
      addIssue('WARNING', 'CI/CD', 'GitLab CI pipeline runs "npm install" instead of "npm ci". This can lead to non-deterministic node_modules installs.');
    }
  } catch (e) {}
}

/**
 * Detailed static audit of Dockerfiles with line-level annotations
 */
function auditDockerfile(filePath, addIssue, auditList, annotatedFiles) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split(/\r?\n/);
    
    let baseImage = 'unknown';
    let baseImageTag = 'none';
    let isMultiStage = false;
    let runsAsRoot = true;
    let cleanPackageCache = true;
    let hasExpose = false;
    let hasHealthcheck = false;
    let usesAdd = false;

    let fromLineCount = 0;
    let aptGetInstallCount = 0;
    let aptGetCleanupCount = 0;
    let apkAddCount = 0;
    let apkCacheCleanupCount = 0;

    const annotations = [];

    lines.forEach((line, idx) => {
      const trimmed = line.trim();
      const parts = trimmed.split(/\s+/);
      const instruction = parts[0]?.toUpperCase();
      const lineNum = idx + 1;

      if (instruction === 'FROM') {
        fromLineCount++;
        const imageSpec = parts[1] || '';
        baseImage = imageSpec;
        if (imageSpec.includes(':')) {
          baseImageTag = imageSpec.split(':')[1];
        } else {
          baseImageTag = 'latest'; // Implicit latest
        }
        if (baseImageTag === 'latest' || baseImageTag === 'none') {
          annotations.push({
            line: lineNum,
            type: 'WARNING',
            category: 'Docker Tag Safety',
            message: `Base image uses non-versioned tag: "${baseImage}"`,
            recommendation: 'Pin your base image tag to a specific version (e.g., node:20-alpine or python:3.11-slim) to prevent unexpected container environment changes.'
          });
        }
      }

      if (instruction === 'USER') {
        const user = parts[1] || '';
        if (user.toLowerCase() !== 'root') {
          runsAsRoot = false;
        } else {
          runsAsRoot = true;
        }
      }

      if (instruction === 'EXPOSE') {
        hasExpose = true;
      }

      if (instruction === 'HEALTHCHECK') {
        hasHealthcheck = true;
      }

      if (instruction === 'ADD') {
        usesAdd = true;
        annotations.push({
          line: lineNum,
          type: 'INFO',
          category: 'Docker Instruction Safety',
          message: 'Using ADD instruction in Dockerfile.',
          recommendation: 'Prefer COPY instead of ADD for local files. ADD has auto-tar extraction and URL retrieval side-effects that can introduce build risks.'
        });
      }

      // Check package cleanup commands
      if (trimmed.includes('apt-get install') || trimmed.includes('apt install')) {
        aptGetInstallCount++;
        const hasCleanup = trimmed.includes('rm -rf /var/lib/apt/lists') || content.includes('rm -rf /var/lib/apt/lists');
        if (!hasCleanup) {
          cleanPackageCache = false;
          annotations.push({
            line: lineNum,
            type: 'WARNING',
            category: 'Container Optimization',
            message: 'Running apt-get install without cleaning lists cache.',
            recommendation: 'Append "&& rm -rf /var/lib/apt/lists/*" in the same RUN step to reduce your Docker image layer size.'
          });
        }
      }
      if (trimmed.includes('apk add')) {
        apkAddCount++;
        const hasNoCache = trimmed.includes('--no-cache') || content.includes('--no-cache');
        if (!hasNoCache) {
          cleanPackageCache = false;
          annotations.push({
            line: lineNum,
            type: 'WARNING',
            category: 'Container Optimization',
            message: 'Running apk add without --no-cache parameter.',
            recommendation: 'Use "apk add --no-cache" to prevent saving download package caches in the runtime image layers.'
          });
        }
      }
    });

    if (fromLineCount > 1) {
      isMultiStage = true;
    }

    if (aptGetInstallCount > 0 && aptGetCleanupCount < aptGetInstallCount) {
      cleanPackageCache = false;
    }
    if (apkAddCount > 0 && apkCacheCleanupCount < apkAddCount) {
      cleanPackageCache = false;
    }

    const report = {
      baseImage,
      baseImageTag,
      isMultiStage,
      runsAsRoot,
      cleanPackageCache,
      hasExpose,
      hasHealthcheck,
      usesAdd
    };
    auditList.push(report);

    // Runs as root check
    if (runsAsRoot) {
      annotations.push({
        line: lines.length,
        type: 'CRITICAL',
        category: 'Docker Container Hardening',
        message: 'No non-root USER instruction configured. Container runs as root.',
        recommendation: 'Create a non-root system user and add the "USER <username>" instruction at the end of your Dockerfile to mitigate container breakout attacks.'
      });
    }

    // Healthcheck check
    if (!hasHealthcheck) {
      annotations.push({
        line: 1,
        type: 'WARNING',
        category: 'Container Healthcheck',
        message: 'Dockerfile is missing a HEALTHCHECK instruction.',
        recommendation: 'Add a HEALTHCHECK instruction (e.g., HEALTHCHECK --interval=30s --timeout=3s CMD curl -f http://localhost:3000/ || exit 1) to allow cloud orchestrators to monitor server health.'
      });
    }

    annotatedFiles['Dockerfile'] = {
      content: content,
      annotations: annotations
    };

    // Raise issues
    if (baseImageTag === 'latest' || baseImageTag === 'none') {
      addIssue('WARNING', 'Docker', 'Dockerfile base image uses the tag "latest" (or no tag). This can lead to unrepeatable builds when base images publish breaking changes.');
    } else {
      addIssue('PASS', 'Docker', `Dockerfile base image is version-locked (${baseImage}).`);
    }

    if (runsAsRoot) {
      addIssue('CRITICAL', 'Docker', 'Dockerfile runs the application as "root" user. Running as non-root is a key container security hardening requirement.');
    } else {
      addIssue('PASS', 'Docker', 'Dockerfile specifies a non-root USER execution instruction.');
    }

    if (usesAdd) {
      addIssue('INFO', 'Docker', 'Dockerfile uses "ADD" instructions. "COPY" is preferred because it is simpler and less prone to remote execution risks.');
    }

    if (!cleanPackageCache) {
      addIssue('WARNING', 'Docker', 'Dockerfile runs package installation (apt-get/apk) but does not clean up download caches. This causes bloated image sizes.');
    }

    if (!isMultiStage) {
      addIssue('INFO', 'Docker', 'Dockerfile is single-stage. Refactoring to a multi-stage Dockerfile can exclude compilation dependencies and reduce image size.');
    } else {
      addIssue('PASS', 'Docker', 'Dockerfile implements a multi-stage build pattern.');
    }

    if (!hasHealthcheck) {
      addIssue('WARNING', 'Docker', 'Dockerfile has no HEALTHCHECK instruction. Production containers should define a healthcheck for orchestrators (like Kubernetes) to monitor availability.');
    }

  } catch (e) {}
}

/**
 * Dockerignore safety audits
 */
function auditDockerIgnore(filePath, addIssue) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split(/\r?\n/).map(l => l.trim());

    const ignoresNodeModules = lines.some(l => l === 'node_modules' || l === 'node_modules/');
    const ignoresGit = lines.some(l => l === '.git' || l === '.git/');
    const ignoresEnv = lines.some(l => l === '.env' || l === '*.env' || l.includes('.env'));

    if (!ignoresNodeModules) {
      addIssue('CRITICAL', 'Docker', '`.dockerignore` file exists but does not ignore `node_modules/`. This will copy local host packages and override Docker packages.');
    }
    if (!ignoresGit) {
      addIssue('WARNING', 'Docker', '`.dockerignore` file does not ignore `.git/` directory, exposing revision history to the container image.');
    }
    if (!ignoresEnv) {
      addIssue('CRITICAL', 'Docker', '`.dockerignore` does not ignore `.env` files. Local secrets risk being packaged inside public/private images.');
    }
  } catch (e) {}
}

module.exports = { checkCICD };
