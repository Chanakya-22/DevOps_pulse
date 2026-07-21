#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const readline = require('readline');
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
  .option('-j, --json', 'Output raw JSON audit result')
  .option('-d, --dir <path>', 'Specify target directory path to audit', process.cwd())
  .parse(process.argv);

const options = program.opts();
const targetDir = path.resolve(options.dir);

if (!fs.existsSync(targetDir)) {
  console.error(pc.red(`Error: Target directory does not exist: ${targetDir}`));
  process.exit(1);
}

// 1. JSON Mode
if (options.json) {
  const audit = analyzeProject(targetDir);
  console.log(JSON.stringify(audit, null, 2));
  process.exit(0);
}

// 2. Terminal Banner
console.log('');
console.log(pc.bold(pc.cyan(' ⚡ DEVOPS PULSE ')) + pc.gray(' v1.0.0 — Real-Time CI/CD Pipeline & Code Auditor'));
console.log(pc.gray(` 📂 Scanning path: `) + pc.bold(targetDir));
console.log(pc.gray('─'.repeat(70)));

// Perform scan
const audit = analyzeProject(targetDir);

// Render Grade & Health Header
let scoreBadge = pc.bold(pc.bgGreen(pc.black(` GRADE ${audit.grade} `)));
if (audit.score < 60) scoreBadge = pc.bold(pc.bgRed(pc.white(` GRADE ${audit.grade} `)));
else if (audit.score < 80) scoreBadge = pc.bold(pc.bgYellow(pc.black(` GRADE ${audit.grade} `)));

console.log(`\n  CI/CD Readiness Score: ${pc.bold(audit.score + '%')}  ${scoreBadge}`);
console.log(`  Health Status: ${pc.cyan(audit.statusSummary)}`);
console.log(`  Tech Stack: ${pc.magenta(audit.structure.detectedStack.join(', '))}`);
console.log(`  Structure: ${pc.white(audit.structure.totalFiles + ' files')} across ${pc.white(audit.structure.totalDirs + ' folders')}\n`);

// Findings Breakdown
console.log(pc.bold(' 📊 Findings Summary:'));
console.log(`    ${pc.red('✖ ' + audit.counts.criticalCount + ' Critical')}   ${pc.yellow('⚠ ' + audit.counts.warningCount + ' Warnings')}   ${pc.blue('ℹ ' + audit.counts.infoCount + ' Info')}   ${pc.green('✔ ' + audit.counts.passCount + ' Passed')}\n`);

console.log(pc.bold(' 🔍 Detailed Audit Log:'));
audit.allIssues.forEach(issue => {
  let tag = pc.blue('[INFO]');
  if (issue.type === 'CRITICAL') tag = pc.red('[CRITICAL]');
  if (issue.type === 'WARNING') tag = pc.yellow('[WARNING]');
  if (issue.type === 'PASS') tag = pc.green('[PASS]');

  console.log(`   ${tag} ${pc.bold('[' + issue.category + ']')} ${issue.message}`);
});

if (audit.security.leakedSecrets.length > 0) {
  console.log('\n ' + pc.bgRed(pc.white(pc.bold(' 🔒 SECURITY RISK DETECTED: POTENTIAL SECRET LEAKS '))));
  audit.security.leakedSecrets.forEach(sec => {
    console.log(`   ${pc.red('⚡')} ${pc.bold(sec.file)}:${pc.yellow(sec.line)} - ${pc.bold(sec.secretType)}`);
    console.log(`      ${pc.gray(sec.snippet)}`);
  });
}

// Recommendations
if (audit.suggestions.length > 0) {
  console.log('\n ' + pc.bold(pc.cyan('💡 Real-Time DevOps Recommendations:')));
  audit.suggestions.forEach((sugg, idx) => {
    console.log(`   ${pc.cyan((idx + 1) + '.')} ${pc.bold(sugg.title)}`);
    console.log(`      ${pc.gray(sugg.description)}`);
    console.log(`      Action: ${pc.green(sugg.actionText)}\n`);
  });
} else {
  console.log('\n ' + pc.green('🎉 Excellent! Your project meets basic CI/CD pipeline necessities.'));
}

// 3. Handle Auto-Fix Flag or Web UI Flag
if (options.web) {
  startServer(targetDir);
} else if (options.fix && audit.suggestions.length > 0) {
  applyFixesInteractively(audit, targetDir);
} else {
  console.log(pc.gray('─'.repeat(70)));
  console.log(pc.gray(` To launch the interactive Web Dashboard: `) + pc.cyan('npx devops-pulse --web'));
  console.log(pc.gray(` To auto-generate recommended CI/CD files: `) + pc.cyan('npx devops-pulse --fix'));
  console.log('');
}

function applyFixesInteractively(auditData, dir) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log('\n ' + pc.bold(pc.green('🛠️ Auto-Fix Generator Mode Enabled:')));

  let p = Promise.resolve();
  auditData.suggestions.forEach(sugg => {
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
  });

  p.then(() => {
    rl.close();
    console.log('\n ' + pc.bold(pc.cyan('✨ All selected fixes applied! Run npx devops-pulse to verify.')));
  });
}
