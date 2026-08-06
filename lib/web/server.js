const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');
const { analyzeProject } = require('../engine/devopsAdvisor');
const { getHistory, saveAudit, getAuditById, deleteAudit } = require('../engine/database');
const {
  generateGitHubWorkflow,
  generateDockerfile,
  generateDockerIgnore,
  generateGitIgnore,
  generateEnvExample
} = require('../generators/fixTemplates');

function startServer(targetDir, port = 3850) {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

  // REST API: Fresh Local Audit Scan
  app.get('/api/audit', (req, res) => {
    try {
      const audit = analyzeProject(targetDir);
      saveAudit(audit);
      res.json(audit);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // REST API: Remote Git Audit Scan
  app.post('/api/audit-remote', (req, res) => {
    const { repoUrl } = req.body;
    if (!repoUrl) {
      return res.status(400).json({ error: 'Repository URL is required.' });
    }

    let url = repoUrl.trim();
    // Convert owner/repo shorthand to full https URL
    if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('git@')) {
      if (/^[a-zA-Z0-9_\-\.]+\/[a-zA-Z0-9_\-\.]+$/.test(url)) {
        url = `https://github.com/${url}.git`;
      } else {
        return res.status(400).json({ error: 'Invalid repository format. Use "owner/repo" or a valid git clone URL.' });
      }
    }

    const tempDir = path.join(os.tmpdir(), `devops-pulse-remote-${Date.now()}`);
    
    try {
      console.log(`\n[Server] Cloning remote repo: ${url} into temporary path ${tempDir}...`);
      execSync(`git clone --depth 1 "${url}" "${tempDir}"`, { stdio: 'ignore' });
      
      console.log(`[Server] Auditing cloned remote codebase...`);
      const audit = analyzeProject(tempDir);
      
      // Delete temporary cloned directory
      fs.rmSync(tempDir, { recursive: true, force: true });
      
      // Format response headers and replace path with url
      audit.projectRoot = url;
      
      // Save scan to database
      saveAudit(audit);
      
      res.json(audit);
    } catch (err) {
      console.error('[Server] Remote audit failed:', err.message);
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
      res.status(500).json({ error: `Failed to clone and audit repository: ${err.message}` });
    }
  });

  // REST API: Get Scan History List
  app.get('/api/history', (req, res) => {
    try {
      const history = getHistory();
      res.json(history);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // REST API: Get Scan History Details
  app.get('/api/history/:id', (req, res) => {
    try {
      const audit = getAuditById(req.params.id);
      if (!audit) {
        return res.status(404).json({ error: 'Audit record not found' });
      }
      res.json(audit);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // REST API: Delete History Record
  app.delete('/api/history/:id', (req, res) => {
    try {
      deleteAudit(req.params.id);
      res.json({ success: true, message: 'Scan history deleted.' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // REST API: Fetch Fix Template for preview / remote audits
  app.get('/api/fix-template', (req, res) => {
    const { fixId, stack } = req.query;
    const detectedStack = stack ? stack.split(',') : [];

    try {
      let content = '';
      let filename = '';

      if (fixId === 'CREATE_GITHUB_WORKFLOW') {
        content = generateGitHubWorkflow(detectedStack);
        filename = '.github/workflows/ci.yml';
      } else if (fixId === 'CREATE_DOCKERFILE') {
        content = generateDockerfile(detectedStack);
        filename = 'Dockerfile';
      } else if (fixId === 'CREATE_GITIGNORE') {
        content = generateGitIgnore(detectedStack);
        filename = '.gitignore';
      } else if (fixId === 'CREATE_ENV_EXAMPLE') {
        content = generateEnvExample(targetDir);
        filename = '.env.example';
      } else {
        return res.status(400).json({ error: 'Unknown fix template requested' });
      }

      res.json({ success: true, filename, content });
    } catch (err) {
      res.status(500).json({ error: 'Failed to generate blueprint: ' + err.message });
    }
  });

  // REST API: Trigger Auto-Fix (Write to local disk)
  app.post('/api/fix', (req, res) => {
    const { fixId, stack } = req.body;
    const detectedStack = stack || [];

    try {
      if (fixId === 'CREATE_GITHUB_WORKFLOW') {
        const workflowDir = path.join(targetDir, '.github', 'workflows');
        fs.mkdirSync(workflowDir, { recursive: true });
        const filePath = path.join(workflowDir, 'ci.yml');
        fs.writeFileSync(filePath, generateGitHubWorkflow(detectedStack), 'utf-8');
        return res.json({ success: true, message: 'Successfully generated `.github/workflows/ci.yml`!' });
      }

      if (fixId === 'CREATE_DOCKERFILE') {
        fs.writeFileSync(path.join(targetDir, 'Dockerfile'), generateDockerfile(detectedStack), 'utf-8');
        fs.writeFileSync(path.join(targetDir, '.dockerignore'), generateDockerIgnore(), 'utf-8');
        return res.json({ success: true, message: 'Successfully generated `Dockerfile` and `.dockerignore`!' });
      }

      if (fixId === 'CREATE_GITIGNORE') {
        fs.writeFileSync(path.join(targetDir, '.gitignore'), generateGitIgnore(detectedStack), 'utf-8');
        return res.json({ success: true, message: 'Successfully generated `.gitignore`!' });
      }

      if (fixId === 'CREATE_ENV_EXAMPLE') {
        fs.writeFileSync(path.join(targetDir, '.env.example'), generateEnvExample(targetDir), 'utf-8');
        return res.json({ success: true, message: 'Successfully generated `.env.example` blueprint!' });
      }

      res.status(400).json({ error: 'Unknown fix requested' });
    } catch (err) {
      res.status(500).json({ error: 'Failed to write fix: ' + err.message });
    }
  });

  const server = app.listen(port, () => {
    const url = `http://localhost:${port}`;
    console.log(`\n  🚀 Web UI Dashboard running live at: ${url}\n`);
    import('open').then((openModule) => {
      const openFn = openModule.default || openModule;
      if (typeof openFn === 'function') {
        openFn(url).catch(() => {});
      }
    }).catch(() => {});
  });

  return server;
}

module.exports = { startServer };
