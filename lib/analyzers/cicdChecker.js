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
    foundPipelines: []
  };

  const keyFiles = new Set(structureStats.keyFiles);

  // 1. GitHub Workflows
  const githubDir = path.join(targetDir, '.github', 'workflows');
  if (fs.existsSync(githubDir)) {
    try {
      const files = fs.readdirSync(githubDir).filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));
      if (files.length > 0) {
        cicd.hasGitHubWorkflows = true;
        cicd.cicdProvider = 'GitHub Actions';
        cicd.foundPipelines.push(...files.map(f => `.github/workflows/${f}`));
      }
    } catch (e) {}
  }

  // 2. Other CI Providers
  if (keyFiles.has('.gitlab-ci.yml')) {
    cicd.cicdProvider = 'GitLab CI';
    cicd.foundPipelines.push('.gitlab-ci.yml');
  }
  if (keyFiles.has('azure-pipelines.yml')) {
    cicd.cicdProvider = 'Azure Pipelines';
    cicd.foundPipelines.push('azure-pipelines.yml');
  }
  if (keyFiles.has('Jenkinsfile')) {
    cicd.cicdProvider = 'Jenkins';
    cicd.foundPipelines.push('Jenkinsfile');
  }

  if (!cicd.cicdProvider) {
    cicd.issues.push({
      type: 'CRITICAL',
      category: 'CI/CD',
      message: 'No CI/CD pipeline detected (missing `.github/workflows/`, `.gitlab-ci.yml`, etc.). Automated testing and shipping are disabled.'
    });
  } else {
    cicd.issues.push({
      type: 'PASS',
      category: 'CI/CD',
      message: `Detected CI/CD provider: ${cicd.cicdProvider} (${cicd.foundPipelines.length} workflow file(s)).`
    });
  }

  // 3. Docker Readiness
  if (keyFiles.has('Dockerfile')) {
    cicd.hasDockerfile = true;
    if (!keyFiles.has('.dockerignore')) {
      cicd.issues.push({
        type: 'WARNING',
        category: 'Docker',
        message: '`Dockerfile` is present but `.dockerignore` is missing! Context transfer during Docker build will be bloated.'
      });
    } else {
      cicd.hasDockerIgnore = true;
    }
  } else {
    cicd.issues.push({
      type: 'INFO',
      category: 'Docker',
      message: 'No `Dockerfile` detected. Containerization pipeline blueprint recommended for container deployment.'
    });
  }

  // 4. Project Basics & Documentation
  cicd.hasReadme = keyFiles.has('README.md') || fs.existsSync(path.join(targetDir, 'readme.md'));
  cicd.hasLicense = keyFiles.has('LICENSE') || fs.existsSync(path.join(targetDir, 'LICENSE.md'));
  cicd.hasGitignore = keyFiles.has('.gitignore');

  if (!cicd.hasReadme) {
    cicd.issues.push({
      type: 'WARNING',
      category: 'Documentation',
      message: 'Missing `README.md`. Project setup instructions and developer onboarding guidance are missing.'
    });
  }

  if (!cicd.hasGitignore) {
    cicd.issues.push({
      type: 'CRITICAL',
      category: 'Git',
      message: 'Missing `.gitignore` file. Generated artifacts, secrets, and node_modules risk polluting source control.'
    });
  }

  return cicd;
}

module.exports = { checkCICD };
