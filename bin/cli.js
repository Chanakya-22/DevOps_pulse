#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const readline = require('readline');
const os = require('os');
const { execSync } = require('child_process');
const pc = require('picocolors');
const { program } = require('commander');
const { analyzeProject } = require('../lib/engine/devopsAdvisor');
const { startServer } = require('../lib/web/server');
const {
  generateGitHubWorkflow,
  generateDockerfile,
  generateDockerIgnore,
  generateGitIgnore,
  generateEnvExample
} = require('../lib/generators/fixTemplates');

program
  .name('devops-pulse')
  .description('Real-time DevOps & CI/CD Pipeline Auditor for any codebase')
  .version('1.0.0')
  .option('-w, --web', 'Launch real-time Web UI Dashboard in browser')
  .option('-f, --fix', 'Auto-apply high priority DevOps fixes (GitHub workflow, Dockerfile, etc.)')
  .option('-c, --check', 'Run a quiet audit for CI pipelines, returning exit code 0 if grade is A or B, and non-zero otherwise')
  .option('-j, --json', 'Output raw JSON audit result')
  .option('-d, --dir <path>', 'Specify target directory path to audit', process.cwd())
  .option('-r, --repo <url>', 'Specify remote GitHub / Git repository URL to clone and audit')
  .parse(process.argv);

const options = program.opts();
let targetDir = path.resolve(options.dir);
let isRemoteRepo = false;
let remoteUrl = '';
let tempDirToDelete = null;

// Clean up helper on exit
function cleanupAndExit(code) {
  if (tempDirToDelete && fs.existsSync(tempDirToDelete)) {
    try {
      fs.rmSync(tempDirToDelete, { recursive: true, force: true });
    } catch (e) {}
  }
  process.exit(code);
}

// Check remote repository parameter
if (options.repo) {
  let url = options.repo.trim();
  if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('git@')) {
    if (/^[a-zA-Z0-9_\-\.]+\/[a-zA-Z0-9_\-\.]+$/.test(url)) {
      url = `https://github.com/${url}.git`;
    } else {
      console.error(pc.red(`Error: Invalid remote repository format. Use "owner/repo" or a valid git clone URL.`));
      cleanupAndExit(1);
    }
  }

  isRemoteRepo = true;
  remoteUrl = url;
  const tempPath = path.join(os.tmpdir(), `devops-pulse-cli-remote-${Date.now()}`);
  tempDirToDelete = tempPath;

  console.log(pc.cyan(`\n  Cloning remote repository: ${url}...`));
  try {
    execSync(`git clone --depth 1 "${url}" "${tempPath}"`, { stdio: 'ignore' });
    targetDir = tempPath;
  } catch (err) {
    console.error(pc.red(`Error: Failed to clone remote repository. Check your URL or network connectivity: ${err.message}`));
    cleanupAndExit(1);
  }
} else if (!fs.existsSync(targetDir)) {
  console.error(pc.red(`Error: Target directory does not exist: ${targetDir}`));
  cleanupAndExit(1);
}

// Execute analysis
const audit = analyzeProject(targetDir);

// Override project root string for output representation
if (isRemoteRepo) {
  audit.projectRoot = remoteUrl;
}

// 1. JSON Mode
if (options.json) {
  console.log(JSON.stringify(audit, null, 2));
  cleanupAndExit(0);
}

// 2. Check Mode (Quiet Audit)
const isDevopsCheckCmd = process.argv[1] && path.basename(process.argv[1]).includes('devops-check');
if (options.check || isDevopsCheckCmd) {
  const isAcceptable = audit.score >= 75; // Grade B or A+

  console.log(`\n${pc.bold(pc.cyan('⚡ DEVOPS PULSE CI CHECK'))}`);
  console.log(`${pc.gray('Target Repository:')} ${pc.white(audit.projectRoot)}`);
  console.log(`${pc.gray('Readiness Score  :')} ${pc.bold(audit.score + '%')} (${pc.bold(audit.grade)})`);

  const failedIssues = audit.allIssues.filter(issue => issue.type === 'CRITICAL' || issue.type === 'WARNING');
  if (failedIssues.length > 0) {
    console.log(`\n${pc.bold('Key Gaps Detected:')}`);
    failedIssues.forEach(issue => {
      const tag = issue.type === 'CRITICAL' ? pc.red('[CRITICAL]') : pc.yellow('[WARNING]');
      console.log(`  ${tag} ${issue.message}`);
    });
  }

  if (isAcceptable) {
    console.log(`\n${pc.green('✔ PASS')} - DevOps readiness grade is acceptable (Grade ${audit.grade}).\n`);
    cleanupAndExit(0);
  } else {
    console.log(`\n${pc.red('✖ FAIL')} - DevOps readiness grade is unacceptable (Grade ${audit.grade}). Minimum grade of B (75% score) is required.\n`);
    cleanupAndExit(1);
  }
}

// 3. Render High-Fidelity Terminal Dashboard
console.log('');
console.log(pc.bold(pc.cyan(' ⚡ DEVOPS PULSE ')) + pc.gray(' v1.1.0 — Real-Time DevOps & CI/CD Auditor'));
console.log(pc.gray(` 📂 Target path: `) + pc.bold(audit.projectRoot));
console.log(pc.gray('─'.repeat(75)));

// Render Grade & Health Header
let scoreBadge = pc.bold(pc.bgGreen(pc.black(` GRADE ${audit.grade} `)));
if (audit.score < 60) scoreBadge = pc.bold(pc.bgRed(pc.white(` GRADE ${audit.grade} `)));
else if (audit.score < 80) scoreBadge = pc.bold(pc.bgYellow(pc.black(` GRADE ${audit.grade} `)));

console.log(`\n  CI/CD Readiness Score: ${pc.bold(audit.score + '%')}  ${scoreBadge}`);
console.log(`  Health Status: ${pc.cyan(audit.statusSummary)}`);
console.log(`  Tech Stack: ${pc.magenta(audit.structure.detectedStack.join(', '))}`);
console.log(`  Codebase Details: ${pc.white(audit.structure.totalFiles + ' files')} | ${pc.white(audit.structure.totalLinesOfCode.toLocaleString() + ' lines of code')}`);

// Render Git Metadata if available
if (audit.structure.git.isGitRepo) {
  console.log(`\n ${pc.bold('📁 Git Repository Analytics:')}`);
  console.log(`    Active Branch:   ${pc.white(audit.structure.git.branch)}`);
  console.log(`    Total Commits:   ${pc.white(audit.structure.git.totalCommits)}`);
  console.log(`    Contributors:    ${pc.white(audit.structure.git.uniqueContributors)} unique authors`);
  if (audit.structure.git.lastCommitHash) {
    console.log(`    Last Commit:     ${pc.gray(audit.structure.git.lastCommitHash)} - ${pc.white(audit.structure.git.lastCommitMessage)} (${pc.gray(audit.structure.git.lastCommitAuthor)})`);
  }
}

// Render Weighted Pillars
console.log(`\n ${pc.bold('📊 DevOps Metric Pillars:')}`);
Object.keys(audit.pillars).forEach(key => {
  const p = audit.pillars[key];
  let pScore = p.score;
  let pColor = pc.green;
  if (pScore < 60) pColor = pc.red;
  else if (pScore < 85) pColor = pc.yellow;
  
  const barLength = Math.round(pScore / 5);
  const progressBar = pc.cyan('█'.repeat(barLength)) + pc.gray('░'.repeat(20 - barLength));
  console.log(`    ${(p.label + ':').padEnd(22)} ${progressBar} ${pColor(pScore.toString().padStart(3) + '%')} (weight: ${p.weight})`);
});

// Findings Breakdown
console.log(`\n ${pc.bold('📈 Findings Summary:')}`);
console.log(`    ${pc.red('✖ ' + audit.counts.criticalCount + ' Critical')}   ${pc.yellow('⚠ ' + audit.counts.warningCount + ' Warnings')}   ${pc.blue('ℹ ' + audit.counts.infoCount + ' Info')}   ${pc.green('✔ ' + audit.counts.passCount + ' Passed')}\n`);

// Detailed Audit Log
console.log(pc.bold(' 🔍 Detailed Audit Log:'));
audit.allIssues.forEach(issue => {
  let tag = pc.blue('[INFO]');
  if (issue.type === 'CRITICAL') tag = pc.red('[CRITICAL]');
  if (issue.type === 'WARNING') tag = pc.yellow('[WARNING]');
  if (issue.type === 'PASS') tag = pc.green('[PASS]');

  console.log(`   ${tag} ${pc.bold('[' + issue.category + ']')} ${issue.message}`);
});

// Render Security vulnerabilities
if (audit.security.leakedSecrets.length > 0) {
  console.log('\n ' + pc.bgRed(pc.white(pc.bold(' 🔒 SECURITY RISK DETECTED: POTENTIAL SECRET LEAKS '))));
  audit.security.leakedSecrets.forEach(sec => {
    console.log(`   ${pc.red('⚡')} ${pc.bold(sec.file)}:${pc.yellow(sec.line)} - ${pc.bold(sec.secretType)}`);
    console.log(`      ${pc.gray(sec.snippet)}`);
  });
}

if (audit.security.committedCerts.length > 0) {
  console.log('\n ' + pc.bgRed(pc.white(pc.bold(' 🔒 SECURITY RISK DETECTED: COMMITTED CERTIFICATES '))));
  audit.security.committedCerts.forEach(file => {
    console.log(`   ${pc.red('⚡')} Private key or certificate file committed: ${pc.bold(file)}`);
  });
}

// Recommendations
if (audit.suggestions.length > 0) {
  console.log('\n ' + pc.bold(pc.cyan('💡 Tailored DevOps Recommendations:')));
  audit.suggestions.forEach((sugg, idx) => {
    console.log(`   ${pc.cyan((idx + 1) + '.')} ${pc.bold(sugg.title)}`);
    console.log(`      ${pc.gray(sugg.description)}`);
    if (!isRemoteRepo) {
      console.log(`      Action: ${pc.green(sugg.actionText)}\n`);
    } else {
      console.log(`      Action: Copy file blueprint from the DevOps Web UI dashboard (--web).\n`);
    }
  });
} else {
  console.log('\n ' + pc.green('🎉 Excellent! Your project meets basic CI/CD pipeline necessities.'));
}

// 4. Handle Auto-Fix Flag or Web UI Flag
if (options.web) {
  // If launching the web server from the cli
  startServer(targetDir);
} else if (options.fix && audit.suggestions.length > 0) {
  if (isRemoteRepo) {
    console.error(pc.red('\n  Error: Auto-fix cannot be applied to a remote repository clone.'));
    cleanupAndExit(1);
  }
  applyFixesInteractively(audit, targetDir);
} else {
  console.log(pc.gray('─'.repeat(75)));
  if (isRemoteRepo) {
    console.log(pc.gray(` To audit the remote repository on the Interactive Web Dashboard: `));
    console.log(pc.cyan(` npx devops-pulse --web`) + pc.gray(` and enter the repository URL in the UI.`));
  } else {
    console.log(pc.gray(` To launch the interactive Web Dashboard: `) + pc.cyan('npx devops-pulse --web'));
    console.log(pc.gray(` To auto-generate recommended CI/CD files: `) + pc.cyan('npx devops-pulse --fix'));
  }
  console.log('');
  cleanupAndExit(0);
}

function applyFixesInteractively(auditData, dir) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log('\n ' + pc.bold(pc.green('🛠️ Auto-Fix Generator Mode Enabled:')));

  let p = Promise.resolve();
  auditData.suggestions.forEach(sugg => {
    // Only apply file generation templates
    if (['CREATE_GITHUB_WORKFLOW', 'CREATE_DOCKERFILE', 'CREATE_GITIGNORE', 'CREATE_ENV_EXAMPLE'].includes(sugg.id)) {
      p = p.then(() => new Promise((resolve) => {
        rl.question(` Do you want to ${pc.cyan(sugg.actionText)}? (y/N) `, (answer) => {
          if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
            try {
              if (sugg.id === 'CREATE_GITHUB_WORKFLOW') {
                const workflowDir = path.join(dir, '.github', 'workflows');
                fs.mkdirSync(workflowDir, { recursive: true });
                fs.writeFileSync(path.join(workflowDir, 'ci.yml'), generateGitHubWorkflow(auditData.structure.detectedStack), 'utf-8');
                console.log(pc.green('   ✔ Created .github/workflows/ci.yml'));
              } else if (sugg.id === 'CREATE_DOCKERFILE') {
                fs.writeFileSync(path.join(dir, 'Dockerfile'), generateDockerfile(auditData.structure.detectedStack), 'utf-8');
                fs.writeFileSync(path.join(dir, '.dockerignore'), generateDockerIgnore(), 'utf-8');
                console.log(pc.green('   ✔ Created Dockerfile & .dockerignore'));
              } else if (sugg.id === 'CREATE_GITIGNORE') {
                fs.writeFileSync(path.join(dir, '.gitignore'), generateGitIgnore(auditData.structure.detectedStack), 'utf-8');
                console.log(pc.green('   ✔ Created .gitignore'));
              } else if (sugg.id === 'CREATE_ENV_EXAMPLE') {
                fs.writeFileSync(path.join(dir, '.env.example'), generateEnvExample(dir), 'utf-8');
                console.log(pc.green('   ✔ Created .env.example'));
              }
            } catch (e) {
              console.log(pc.red('   ✖ Failed to create file: ' + e.message));
            }
          }
          resolve();
        });
      }));
    }
  });

  p.then(() => {
    rl.close();
    console.log('\n ' + pc.bold(pc.cyan('✨ Selected fixes applied! Run npx devops-pulse to re-verify.')));
    cleanupAndExit(0);
  });
}
