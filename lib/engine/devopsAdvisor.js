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

  // ----------------------------------------------------
  // WEIGHTED SCORING SYSTEM (4 PILLARS)
  // ----------------------------------------------------
  
  // Pillar 1: Pipeline Automation (30% weight)
  let pipelineScore = 0;
  if (cicd.cicdProvider) {
    pipelineScore += 40; // Base presence
    
    // Add points for workflow quality (derived from workflow audits)
    const audits = cicd.details.workflowAudits || [];
    if (audits.length > 0) {
      let unpinnedCount = 0;
      let missingCacheCount = 0;
      let npmInstallCount = 0;
      
      audits.forEach(a => {
        if (a.usesUnpinnedAction) unpinnedCount++;
        if (a.missingCache) missingCacheCount++;
        if (a.usesNpmInstall) npmInstallCount++;
      });

      if (unpinnedCount === 0) pipelineScore += 20;
      else pipelineScore += Math.max(0, 20 - unpinnedCount * 5);

      if (missingCacheCount === 0) pipelineScore += 20;
      else pipelineScore += Math.max(0, 20 - missingCacheCount * 5);

      if (npmInstallCount === 0) pipelineScore += 20;
      else pipelineScore += Math.max(0, 20 - npmInstallCount * 5);
    } else {
      // Default points for GitLab/Travis etc. if they exist and pass basic checks
      pipelineScore += 60;
    }
  }

  // Pillar 2: Security & secrets Hygiene (30% weight)
  let securityScore = 100;
  if (security.leakedSecrets.length > 0) {
    securityScore -= Math.min(60, security.leakedSecrets.length * 20);
  }
  if (security.committedCerts.length > 0) {
    securityScore -= Math.min(40, security.committedCerts.length * 20);
  }
  const hasEnvMsg = allIssues.some(i => i.message.includes('.env file exists in project root but is NOT ignored'));
  if (hasEnvMsg) securityScore -= 25;

  const hasEnvExMsg = allIssues.some(i => i.message.includes('but no .env.example'));
  if (hasEnvExMsg) securityScore -= 10;

  const workflowSecIssue = cicd.details.workflowAudits?.some(a => a.hasHardcodedSecret);
  if (workflowSecIssue) securityScore -= 20;
  
  securityScore = Math.max(0, securityScore);

  // Pillar 3: Dependency Health (20% weight)
  let dependencyScore = 100;
  if (dependencies.hasDependencyFile) {
    dependencyScore = 30; // Base for having dependencies
    
    if (dependencies.hasLockfile) dependencyScore += 30;

    // Pinning ratio contribution
    const total = dependencies.details.totalDependencies || 0;
    const pinned = dependencies.details.pinnedDependencies || 0;
    if (total > 0) {
      const pinRatio = pinned / total;
      dependencyScore += Math.round(pinRatio * 30);
    } else {
      dependencyScore += 30; // No dependencies listed means 100% pinned (trivially)
    }

    // Scripts check
    if (dependencies.missingScripts.includes('test')) dependencyScore -= 10;
    if (dependencies.missingScripts.includes('build')) dependencyScore -= 10;
  }
  dependencyScore = Math.max(0, dependencyScore);

  // Pillar 4: Containerization & Docker (20% weight)
  let dockerScore = 100;
  if (cicd.hasDockerfile) {
    dockerScore = 40; // Base for having Dockerfile
    
    const dockerAudits = cicd.details.dockerfileAudits || [];
    if (dockerAudits.length > 0) {
      const audit = dockerAudits[0];
      if (audit.isMultiStage) dockerScore += 10;
      if (!audit.runsAsRoot) dockerScore += 15;
      if (audit.baseImageTag !== 'latest' && audit.baseImageTag !== 'none') dockerScore += 15;
      if (audit.cleanPackageCache) dockerScore += 10;
      if (cicd.hasDockerIgnore) dockerScore += 10;
    }
  } else {
    // If project is static website, don't penalize missing Dockerfile heavily
    const isStatic = structure.detectedStack.includes('Static HTML/CSS/JS');
    if (isStatic) {
      dockerScore = 90;
    } else {
      dockerScore = 70; // Penalize lack of containerization slightly for backend services
    }
  }

  // Calculate Weighted Score
  let score = Math.round(
    (pipelineScore * 0.3) +
    (securityScore * 0.3) +
    (dependencyScore * 0.2) +
    (dockerScore * 0.2)
  );

  score = Math.max(0, Math.min(100, score));

  // Determine Grade
  let grade = 'A+';
  let statusColor = 'green';
  let statusSummary = 'Production Ready Pipeline';

  if (score < 40) {
    grade = 'F';
    statusColor = 'red';
    statusSummary = 'High Risk - Massive DevOps Gaps & Vulnerabilities';
  } else if (score < 60) {
    grade = 'D';
    statusColor = 'red';
    statusSummary = 'Poor - Lacks Key Deployment and Security Controls';
  } else if (score < 75) {
    grade = 'C';
    statusColor = 'yellow';
    statusSummary = 'Moderate - Missing Pipeline Automation and Hardening';
  } else if (score < 90) {
    grade = 'B';
    statusColor = 'yellow';
    statusSummary = 'Good - Fully Functional, Recommend Minor Hardening';
  }

  // Count Issues
  let criticalCount = 0;
  let warningCount = 0;
  let infoCount = 0;
  let passCount = 0;

  allIssues.forEach(issue => {
    if (issue.type === 'CRITICAL') criticalCount++;
    else if (issue.type === 'WARNING') warningCount++;
    else if (issue.type === 'INFO') infoCount++;
    else if (issue.type === 'PASS') passCount++;
  });

  // Generate Actionable DevOps Recommendations
  const suggestions = [];

  // Suggest CI/CD Workflow
  if (!cicd.hasGitHubWorkflows && !cicd.cicdProvider) {
    suggestions.push({
      id: 'CREATE_GITHUB_WORKFLOW',
      title: 'Generate CI/CD Automation Pipeline',
      actionText: 'Create `.github/workflows/ci.yml`',
      description: 'Automatically runs build, tests, and static lint checks on every pull request and git push.',
      priority: 'HIGH',
      targetFile: '.github/workflows/ci.yml'
    });
  }

  // Suggest Gitignore
  if (!cicd.hasGitignore) {
    suggestions.push({
      id: 'CREATE_GITIGNORE',
      title: 'Add Project `.gitignore` File',
      actionText: 'Create `.gitignore`',
      description: 'Prevents node_modules, local credentials (.env), build output directories, and OS logs from cluttering git version history.',
      priority: 'HIGH',
      targetFile: '.gitignore'
    });
  }

  // Suggest .env.example
  if (security.issues.some(i => i.message.includes('.env.example'))) {
    suggestions.push({
      id: 'CREATE_ENV_EXAMPLE',
      title: 'Generate Configuration Blueprint (.env.example)',
      actionText: 'Create `.env.example`',
      description: 'Extracts safe config parameter keys from your .env file, providing a dummy placeholder template for collaborative onboarding.',
      priority: 'MEDIUM',
      targetFile: '.env.example'
    });
  }

  // Suggest Dockerfile
  if (!cicd.hasDockerfile && !structure.detectedStack.includes('Static HTML/CSS/JS')) {
    suggestions.push({
      id: 'CREATE_DOCKERFILE',
      title: 'Generate Multi-Stage Dockerfile',
      actionText: 'Create `Dockerfile` & `.dockerignore`',
      description: 'Packages your app into a secure, multi-stage runtime container for predictable production hosting.',
      priority: 'MEDIUM',
      targetFile: 'Dockerfile'
    });
  }

  // Suggest Pinning dependencies
  if (dependencies.unpinnedCount > 0) {
    suggestions.push({
      id: 'PIN_DEPENDENCY_VERSIONS',
      title: 'Pin Loose Dependencies to Exact Versions',
      actionText: 'Verify dependencies in configuration file',
      description: 'Locks dependency specifiers to exact versions (e.g. == version or numbers) in package.json or requirements.txt.',
      priority: 'MEDIUM',
      targetFile: dependencies.hasDependencyFile ? 'Dependency Manifest' : 'package.json'
    });
  }

  // Suggest action version pinning in workflow
  const unpinnedWorkflows = cicd.details.workflowAudits?.filter(w => w.usesUnpinnedAction);
  if (unpinnedWorkflows && unpinnedWorkflows.length > 0) {
    suggestions.push({
      id: 'PIN_GITHUB_ACTIONS',
      title: 'Pin Action Releases in GitHub Workflows',
      actionText: 'Pin actions to version releases',
      description: 'Avoid referencing GitHub actions via branch refs like @master or @main. Pin them to specific tags (e.g. @v4) or SHA commits.',
      priority: 'MEDIUM',
      targetFile: unpinnedWorkflows[0].file
    });
  }

  // Suggest docker security: non-root USER
  const rootDockerfiles = cicd.details.dockerfileAudits?.filter(d => d.runsAsRoot);
  if (cicd.hasDockerfile && rootDockerfiles && rootDockerfiles.length > 0) {
    suggestions.push({
      id: 'HARDEN_DOCKER_USER',
      title: 'Configure Non-Root USER in Dockerfile',
      actionText: 'Specify USER instruction',
      description: 'Harden your Docker execution container by defining a non-root USER to mitigate runtime container breakout vulnerabilities.',
      priority: 'HIGH',
      targetFile: 'Dockerfile'
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
    pillars: {
      pipeline: { score: pipelineScore, label: 'Pipeline Automation', weight: '30%' },
      security: { score: securityScore, label: 'Security & Secrets', weight: '30%' },
      dependency: { score: dependencyScore, label: 'Dependency Health', weight: '20%' },
      docker: { score: dockerScore, label: 'Containerization', weight: '20%' }
    },
    structure,
    dependencies,
    security,
    cicd,
    allIssues,
    suggestions
  };
}

module.exports = { analyzeProject };
