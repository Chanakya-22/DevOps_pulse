const { scanStructure } = require('../analyzers/structureScanner');
const { auditDependencies } = require('../analyzers/dependencyAuditor');
const { scanSecurity } = require('../analyzers/securityScanner');
const { checkCICD } = require('../analyzers/cicdChecker');

function analyzeProject(targetDir) {
  const structure = scanStructure(targetDir);
  const dependencies = auditDependencies(targetDir, structure);
  const security = scanSecurity(targetDir, structure);
  const cicd = checkCICD(targetDir, structure);

  // Consolidate all issues
  const allIssues = [
    ...dependencies.issues,
    ...security.issues,
    ...cicd.issues
  ];

  // Calculate CI/CD Readiness Score
  let score = 100;
  let criticalCount = 0;
  let warningCount = 0;
  let infoCount = 0;
  let passCount = 0;

  allIssues.forEach(issue => {
    if (issue.type === 'CRITICAL') {
      score -= 20;
      criticalCount++;
    } else if (issue.type === 'WARNING') {
      score -= 10;
      warningCount++;
    } else if (issue.type === 'INFO') {
      score -= 3;
      infoCount++;
    } else if (issue.type === 'PASS') {
      passCount++;
    }
  });

  score = Math.max(0, Math.min(100, score));

  // Determine Overall Grade & Health Status
  let grade = 'A+';
  let statusColor = 'green';
  let statusSummary = 'Production Ready Pipeline';

  if (score < 40) {
    grade = 'F';
    statusColor = 'red';
    statusSummary = 'High Risk - Pipeline Action Needed Immediately';
  } else if (score < 60) {
    grade = 'D';
    statusColor = 'red';
    statusSummary = 'Poor - Significant DevOps Gaps';
  } else if (score < 75) {
    grade = 'C';
    statusColor = 'yellow';
    statusSummary = 'Moderate - Missing Key Automation & Security Controls';
  } else if (score < 90) {
    grade = 'B';
    statusColor = 'yellow';
    statusSummary = 'Good - Minor Improvements Recommended';
  }

  // Generate Tailored Actionable Advice
  const suggestions = [];

  if (!cicd.hasGitHubWorkflows && !cicd.cicdProvider) {
    suggestions.push({
      id: 'CREATE_GITHUB_WORKFLOW',
      title: 'Setup Automated GitHub Actions Workflow',
      actionText: 'Generate `.github/workflows/ci.yml`',
      description: 'Automates linting, test execution, and build checks on every git push and pull request.',
      priority: 'HIGH',
      targetFile: '.github/workflows/ci.yml'
    });
  }

  if (!cicd.hasGitignore) {
    suggestions.push({
      id: 'CREATE_GITIGNORE',
      title: 'Add Standard `.gitignore` File',
      actionText: 'Generate `.gitignore`',
      description: 'Prevents accidentally checking in `node_modules`, `.env` files, build logs, and OS cache files.',
      priority: 'HIGH',
      targetFile: '.gitignore'
    });
  }

  if (security.issues.some(i => i.message.includes('.env.example'))) {
    suggestions.push({
      id: 'CREATE_ENV_EXAMPLE',
      title: 'Create Safe `.env.example` Blueprint',
      actionText: 'Generate `.env.example`',
      description: 'Provides team members and CI pipelines with an environment variable blueprint without exposing real secrets.',
      priority: 'MEDIUM',
      targetFile: '.env.example'
    });
  }

  if (!cicd.hasDockerfile) {
    suggestions.push({
      id: 'CREATE_DOCKERFILE',
      title: 'Add Production Multi-Stage `Dockerfile`',
      actionText: 'Generate `Dockerfile` & `.dockerignore`',
      description: 'Standardizes runtime execution environment for deployment to AWS, GCP, Railway, Render, or Kubernetes.',
      priority: 'MEDIUM',
      targetFile: 'Dockerfile'
    });
  }

  if (dependencies.missingScripts.includes('test')) {
    suggestions.push({
      id: 'ADD_TEST_SCRIPT',
      title: 'Add Automated Testing Script in package.json',
      actionText: 'Add `"test": "jest"` or `"test": "vitest"` to package.json',
      description: 'Enables CI runner to execute automated verification of project code quality before shipping.',
      priority: 'HIGH',
      targetFile: 'package.json'
    });
  }

  return {
    timestamp: new Date().toISOString(),
    projectRoot: targetDir,
    score,
    grade,
    statusColor,
    statusSummary,
    counts: { criticalCount, warningCount, infoCount, passCount },
    structure,
    dependencies,
    security,
    cicd,
    allIssues,
    suggestions
  };
}

module.exports = { analyzeProject };
