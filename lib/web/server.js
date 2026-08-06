const express = require('express');
const path = require('path');
const fs = require('fs');
const { analyzeProject } = require('../engine/devopsAdvisor');
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

  // REST API: Fresh Audit Scan
  app.get('/api/audit', (req, res) => {
    try {
      const audit = analyzeProject(targetDir);
      res.json(audit);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // REST API: Trigger Auto-Fix
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
