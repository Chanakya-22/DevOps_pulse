let currentAuditData = null;

document.addEventListener('DOMContentLoaded', () => {
  fetchAuditData();
  setupTabs();
  setupFilters();

  // Load local project
  document.getElementById('rescan-btn').addEventListener('click', () => {
    document.getElementById('remote-repo-url').value = '';
    fetchAuditData();
  });

  // Load remote project (clone & scan)
  document.getElementById('remote-audit-btn').addEventListener('click', () => {
    auditRemoteRepository();
  });

  // Modal close handlers
  document.getElementById('close-modal-btn').addEventListener('click', hideModal);
  window.addEventListener('click', (e) => {
    const modal = document.getElementById('preview-modal');
    if (e.target === modal) {
      hideModal();
    }
  });

  // Copy blueprint handler
  document.getElementById('copy-blueprint-btn').addEventListener('click', () => {
    const code = document.getElementById('modal-code').textContent;
    navigator.clipboard.writeText(code).then(() => {
      const copyBtn = document.getElementById('copy-blueprint-btn');
      const originalText = copyBtn.innerHTML;
      copyBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
        Copied!
      `;
      setTimeout(() => {
        copyBtn.innerHTML = originalText;
      }, 2000);
    });
  });
});

// Tab navigation handler
function setupTabs() {
  const tabs = document.querySelectorAll('.tab-btn');
  tabs.forEach(tab => {
    tab.addEventListener('click', (e) => {
      // Toggle button classes
      tabs.forEach(t => t.classList.remove('active'));
      e.target.classList.add('active');

      // Toggle content panel classes
      const targetPanelId = e.target.dataset.tab;
      const panels = document.querySelectorAll('.tab-content');
      panels.forEach(p => p.classList.remove('active'));
      document.getElementById(targetPanelId).classList.add('active');

      // Fetch fresh data if history tab is selected
      if (targetPanelId === 'history-tab') {
        fetchHistory();
      }
    });
  });
}

async function fetchAuditData() {
  try {
    const scanBadge = document.getElementById('scan-type-badge');
    scanBadge.textContent = 'Scanning...';
    scanBadge.className = 'status-badge local';

    const res = await fetch('/api/audit');
    const data = await res.json();
    currentAuditData = data;
    renderDashboard(data);
  } catch (err) {
    console.error('Failed to fetch local audit data:', err);
  }
}

async function auditRemoteRepository() {
  const repoUrlInput = document.getElementById('remote-repo-url');
  const url = repoUrlInput.value.trim();
  if (!url) {
    alert('Please enter a valid Git URL or owner/repo shorthand.');
    return;
  }

  const auditBtn = document.getElementById('remote-audit-btn');
  const originalHtml = auditBtn.innerHTML;
  
  try {
    // Set loading state
    auditBtn.disabled = true;
    auditBtn.innerHTML = `
      <svg class="spinner" width="16" height="16" viewBox="0 0 50 50" style="animation: spin 1s linear infinite; margin-right: 0.5rem;">
        <circle cx="25" cy="25" r="20" fill="none" stroke="currentColor" stroke-width="5" stroke-dasharray="80, 200" stroke-dashoffset="0"></circle>
      </svg>
      Cloning & Auditing...
    `;
    
    // Inject keyframes style if not exists
    if (!document.getElementById('spin-keyframes')) {
      const style = document.createElement('style');
      style.id = 'spin-keyframes';
      style.textContent = `
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `;
      document.head.appendChild(style);
    }

    const res = await fetch('/api/audit-remote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoUrl: url })
    });
    
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Failed to scan remote repository');
    }

    const data = await res.json();
    currentAuditData = data;
    renderDashboard(data);
  } catch (err) {
    alert('Remote Scan Failed: ' + err.message);
  } finally {
    auditBtn.disabled = false;
    auditBtn.innerHTML = originalHtml;
  }
}

// Fetch scan records list from database
async function fetchHistory() {
  const container = document.getElementById('history-logs-list');
  container.innerHTML = `
    <div style="color:var(--text-secondary); text-align:center; padding:3rem; font-family:var(--font-main);">
      <p>Loading audit database records...</p>
    </div>
  `;

  try {
    const res = await fetch('/api/history');
    const history = await res.json();
    
    container.innerHTML = '';
    if (history.length === 0) {
      container.innerHTML = `
        <div class="card" style="text-align:center; padding:3rem; color:var(--text-secondary);">
          <p>No scans logged in the database yet. Run an audit on a local or remote repository to record logs.</p>
        </div>
      `;
      return;
    }

    history.forEach(record => {
      const dateStr = new Date(record.timestamp).toLocaleString();
      const card = document.createElement('div');
      card.className = 'history-card';
      
      let badgeColor = '#10b981';
      if (record.score < 60) badgeColor = '#ef4444';
      else if (record.score < 80) badgeColor = '#f59e0b';

      card.innerHTML = `
        <div class="history-info">
          <span class="history-repo">${record.projectRoot}</span>
          <div class="history-meta">
            <span>📅 Scanned: ${dateStr}</span>
            <span>💻 Stack: ${record.detectedStack.join(', ') || 'Unknown'}</span>
            <span>🤖 CI Provider: ${record.cicdProvider}</span>
          </div>
        </div>
        <div class="history-score-badge">
          <span class="status-badge" style="background: rgba(255,255,255,0.03); color: var(--text-primary); border: 1px solid var(--card-border);">Score ${record.score}%</span>
          <span class="badge grade-badge" style="background-color: ${badgeColor}22; color: ${badgeColor}; border: 1px solid ${badgeColor}33; font-weight:800; font-size:0.95rem;">${record.grade}</span>
        </div>
        <div class="history-actions">
          <button class="btn btn-secondary load-hist-btn" data-id="${record.id}">
            Load Scan
          </button>
          <button class="btn btn-secondary delete-hist-btn" data-id="${record.id}" style="border-color: rgba(239, 68, 68, 0.2); color:#ef4444; background:rgba(239,68,68,0.02)">
            Delete
          </button>
        </div>
      `;

      card.querySelector('.load-hist-btn').addEventListener('click', () => loadHistoricalScan(record.id));
      card.querySelector('.delete-hist-btn').addEventListener('click', () => deleteHistoricalScan(record.id));

      container.appendChild(card);
    });
  } catch (err) {
    container.innerHTML = `<div class="card"><p style="color:var(--color-critical)">Failed to query scan history: ${err.message}</p></div>`;
  }
}

async function loadHistoricalScan(id) {
  try {
    const res = await fetch(`/api/history/${id}`);
    if (!res.ok) throw new Error('Could not retrieve record details');
    const data = await res.json();
    currentAuditData = data;
    renderDashboard(data);
    
    // Switch to Dashboard Tab
    const tabs = document.querySelectorAll('.tab-btn');
    tabs.forEach(t => t.classList.remove('active'));
    document.querySelector('.tab-btn[data-tab="dashboard-tab"]').classList.add('active');
    
    document.querySelectorAll('.tab-content').forEach(p => p.classList.remove('active'));
    document.getElementById('dashboard-tab').classList.add('active');
    
    alert('Historical scan audit loaded successfully.');
  } catch (err) {
    alert('Failed to load scan details: ' + err.message);
  }
}

async function deleteHistoricalScan(id) {
  if (!confirm('Are you sure you want to delete this scan from the history log database?')) return;
  try {
    const res = await fetch(`/api/history/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Delete request failed');
    fetchHistory();
  } catch (err) {
    alert('Failed to delete history record: ' + err.message);
  }
}

function renderDashboard(data) {
  // Update Path
  document.getElementById('project-path').textContent = data.projectRoot;

  // Scan badge type (Local vs Remote)
  const scanBadge = document.getElementById('scan-type-badge');
  const isRemote = data.projectRoot.startsWith('http') || data.projectRoot.startsWith('git@');
  if (isRemote) {
    scanBadge.textContent = 'Remote Repository';
    scanBadge.className = 'status-badge remote';
  } else {
    scanBadge.textContent = 'Local Codebase';
    scanBadge.className = 'status-badge local';
  }

  // Score & Grade
  document.getElementById('score-num').textContent = data.score;
  const fill = document.getElementById('gauge-fill');
  const dashOffset = 264 - (264 * data.score) / 100;
  fill.style.strokeDashoffset = dashOffset;

  const gradeBadge = document.getElementById('grade-badge');
  gradeBadge.textContent = `Grade ${data.grade}`;
  gradeBadge.style.backgroundColor = data.score >= 80 ? 'rgba(16, 185, 129, 0.2)' : data.score >= 60 ? 'rgba(245, 158, 11, 0.2)' : 'rgba(239, 68, 68, 0.2)';
  gradeBadge.style.color = data.score >= 80 ? '#10b981' : data.score >= 60 ? '#f59e0b' : '#ef4444';

  document.getElementById('status-summary').textContent = data.statusSummary;

  // Counts
  document.getElementById('cnt-critical').textContent = data.counts.criticalCount;
  document.getElementById('cnt-warning').textContent = data.counts.warningCount;
  document.getElementById('cnt-info').textContent = data.counts.infoCount;
  document.getElementById('cnt-pass').textContent = data.counts.passCount;

  // Render 4-Pillar breakdown
  const pillarsContainer = document.getElementById('pillars-container');
  pillarsContainer.innerHTML = '';
  if (data.pillars) {
    Object.keys(data.pillars).forEach(key => {
      const p = data.pillars[key];
      const row = document.createElement('div');
      row.className = 'pillar-row';
      row.innerHTML = `
        <div class="pillar-info">
          <span class="pillar-label">${p.label}</span>
          <span class="pillar-score" style="color: ${p.score >= 85 ? '#10b981' : p.score >= 60 ? '#f59e0b' : '#ef4444'}">${p.score}%</span>
        </div>
        <div class="pillar-bar-bg">
          <div class="pillar-bar-fill" style="width: ${p.score}%; background: linear-gradient(90deg, ${p.score >= 80 ? '#10b981' : p.score >= 60 ? '#f59e0b' : '#ef4444'}, #8b5cf6)"></div>
        </div>
      `;
      pillarsContainer.appendChild(row);
    });
  }

  // Tech Stack Tags
  const stackContainer = document.getElementById('stack-tags');
  stackContainer.innerHTML = '';
  data.structure.detectedStack.forEach(tech => {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = tech;
    stackContainer.appendChild(tag);
  });

  const linesFormatted = data.structure.totalLinesOfCode ? ` / ${data.structure.totalLinesOfCode.toLocaleString()} lines` : '';
  document.getElementById('file-stats').textContent = `${data.structure.totalFiles} files${linesFormatted}`;
  document.getElementById('cicd-provider').textContent = data.cicd.cicdProvider || 'None Detected';
  document.getElementById('lockfile-status').textContent = data.dependencies.lockfileType || 'Missing Lockfile';

  // Git repo info
  const gitBox = document.getElementById('git-info-box');
  if (data.structure.git && data.structure.git.isGitRepo) {
    gitBox.style.display = 'block';
    document.getElementById('git-branch').textContent = data.structure.git.branch;
    document.getElementById('git-commits').textContent = data.structure.git.totalCommits;
    document.getElementById('git-authors').textContent = `${data.structure.git.uniqueContributors} contributors`;
  } else {
    gitBox.style.display = 'none';
  }

  // Suggestions
  renderSuggestions(data.suggestions, data.structure.detectedStack, isRemote);

  // Issues
  renderIssues(data.allIssues, 'ALL');

  // Key Files
  const keyFilesList = document.getElementById('key-files-list');
  keyFilesList.innerHTML = '';
  if (data.structure.keyFiles.length === 0) {
    keyFilesList.innerHTML = '<span class="value-text" style="color:var(--text-secondary)">No standard config files found.</span>';
  } else {
    data.structure.keyFiles.forEach(file => {
      const pill = document.createElement('div');
      pill.className = 'key-file-pill';
      pill.textContent = file;
      keyFilesList.appendChild(pill);
    });
  }

  // Render CodeRabbit reviews sidebar list
  renderCodeReviewsSidebar(data);
}

// Populate file review selection sidebar
function renderCodeReviewsSidebar(data) {
  const sidebarList = document.getElementById('review-files-list');
  sidebarList.innerHTML = '';

  const annotated = data.cicd?.annotatedFiles || {};
  const filePaths = Object.keys(annotated);

  if (filePaths.length === 0) {
    sidebarList.innerHTML = '<p style="color:var(--text-secondary); font-size:0.8rem; padding:1rem 0;">No CI/CD configuration files (Dockerfile or workflows) found to review.</p>';
    document.getElementById('reviewing-filename').textContent = 'Select a file to inspect reviews';
    document.getElementById('review-file-badge').style.display = 'none';
    document.getElementById('review-code-table').innerHTML = `
      <div style="color:var(--text-secondary); text-align:center; padding:3rem; font-family:var(--font-main);">
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom:1rem; color:var(--text-secondary); opacity:0.5;"><circle cx="12" cy="12" r="10"></circle><line x1="8" y1="12" x2="16" y2="12"></line></svg>
        <p>No annotated CI/CD files detected in this repository scan.</p>
      </div>
    `;
    return;
  }

  filePaths.forEach(filePath => {
    const fileData = annotated[filePath];
    const issuesCount = fileData.annotations ? fileData.annotations.length : 0;
    
    const item = document.createElement('div');
    item.className = 'file-item';
    item.innerHTML = `
      <span>${filePath}</span>
      ${issuesCount > 0 ? `<span class="issue-count-pill ${issuesCount > 2 ? 'critical' : 'warning'}">${issuesCount}</span>` : ''}
    `;

    item.addEventListener('click', () => {
      // Toggle active status
      document.querySelectorAll('.file-item').forEach(el => el.classList.remove('active'));
      item.classList.add('active');
      renderFileReviewCode(filePath, fileData);
    });

    sidebarList.appendChild(item);
  });

  // Default select first file
  sidebarList.firstElementChild.click();
}

// Render CodeRabbit Code Viewer with comments embedded directly underneath code lines
function renderFileReviewCode(filename, fileData) {
  document.getElementById('reviewing-filename').textContent = filename;
  
  const badge = document.getElementById('review-file-badge');
  const count = fileData.annotations ? fileData.annotations.length : 0;
  
  badge.style.display = 'inline-block';
  badge.textContent = `${count} Finding${count === 1 ? '' : 's'}`;
  badge.className = `status-badge ${count > 0 ? (count > 2 ? 'remote' : 'local') : 'local'}`;
  if (count === 0) {
    badge.style.background = 'rgba(16, 185, 129, 0.15)';
    badge.style.color = '#10b981';
    badge.style.borderColor = 'rgba(16, 185, 129, 0.3)';
    badge.textContent = '0 Findings';
  } else {
    // Critical colors if heavy issues
    const isCritical = fileData.annotations.some(a => a.type === 'CRITICAL');
    badge.style.background = isCritical ? 'rgba(239, 68, 68, 0.15)' : 'rgba(245, 158, 11, 0.15)';
    badge.style.color = isCritical ? '#ef4444' : '#f59e0b';
    badge.style.borderColor = isCritical ? 'rgba(239, 68, 68, 0.3)' : 'rgba(245, 158, 11, 0.3)';
  }

  const container = document.getElementById('review-code-table');
  container.innerHTML = '';

  const lines = fileData.content.split(/\r?\n/);
  
  lines.forEach((lineText, idx) => {
    const lineNum = idx + 1;
    
    // Find if there is an annotation for this line
    const matchAnnotations = fileData.annotations ? fileData.annotations.filter(a => a.line === lineNum) : [];

    const row = document.createElement('div');
    row.className = 'code-row';
    
    // Highlight code line backgrounds
    if (matchAnnotations.length > 0) {
      const hasCritical = matchAnnotations.some(a => a.type === 'CRITICAL');
      row.classList.add(hasCritical ? 'highlighted' : 'highlighted-warning');
    }

    row.innerHTML = `
      <div class="code-num">${lineNum}</div>
      <div class="code-line">${escapeHtml(lineText)}</div>
    `;
    container.appendChild(row);

    // Append CodeRabbit Comment Card box if matched
    matchAnnotations.forEach(ann => {
      const commentRow = document.createElement('div');
      commentRow.className = 'review-comment-row';
      commentRow.innerHTML = `
        <div class="review-comment-spacer"></div>
        <div class="review-comment-content">
          <div class="comment-card ${ann.type}">
            <div class="comment-header">
              <span style="color: ${ann.type === 'CRITICAL' ? 'var(--color-critical)' : (ann.type === 'WARNING' ? 'var(--color-warning)' : 'var(--color-info)')}">
                ${ann.type} — ${ann.category}
              </span>
              <span style="color: var(--text-secondary); font-family: var(--font-mono)">Line ${ann.line}</span>
            </div>
            <div class="comment-body">
              ${ann.message}
            </div>
            <div class="comment-reco">
              💡 <strong>Recommendation:</strong> ${ann.recommendation}
            </div>
          </div>
        </div>
      `;
      container.appendChild(commentRow);
    });
  });
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderSuggestions(suggestions, stack, isRemote) {
  const container = document.getElementById('suggestions-list');
  container.innerHTML = '';

  if (!suggestions || suggestions.length === 0) {
    container.innerHTML = '<div class="sugg-card"><p class="sugg-title">🎉 Great job! No critical fixes required.</p><p class="sugg-desc">Your pipeline configurations meet recommended best practices.</p></div>';
    return;
  }

  suggestions.forEach(sugg => {
    const card = document.createElement('div');
    card.className = 'sugg-card';

    // Tailor actions for remote audits
    const btnLabel = isRemote ? 'Preview Blueprint' : sugg.actionText;
    const btnIcon = isRemote ? 
      `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>` :
      `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>`;

    card.innerHTML = `
      <div>
        <h3 class="sugg-title" style="display:flex; align-items:center; gap:0.4rem;">
          <span style="color: ${sugg.priority === 'HIGH' ? '#ef4444' : '#f59e0b'}">●</span>
          ${sugg.title}
        </h3>
        <p class="sugg-desc">${sugg.description}</p>
      </div>
      <button class="btn btn-primary fix-btn" data-id="${sugg.id}" style="${isRemote ? 'background: linear-gradient(135deg, var(--accent-purple), #6d28d9); box-shadow: 0 4px 15px rgba(139, 92, 246, 0.3)' : ''}">
        ${btnIcon}
        ${btnLabel}
      </button>
    `;

    card.querySelector('.fix-btn').addEventListener('click', () => {
      if (isRemote) {
        previewFixTemplate(sugg.id, stack);
      } else {
        applyFix(sugg.id, stack);
      }
    });
    container.appendChild(card);
  });
}

async function applyFix(fixId, stack) {
  try {
    const res = await fetch('/api/fix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fixId, stack })
    });
    const result = await res.json();
    alert(result.message);
    fetchAuditData();
  } catch (err) {
    alert('Failed to apply fix: ' + err.message);
  }
}

async function previewFixTemplate(fixId, stack) {
  try {
    const stackQuery = stack ? stack.join(',') : '';
    const res = await fetch(`/api/fix-template?fixId=${fixId}&stack=${encodeURIComponent(stackQuery)}`);
    const data = await res.json();
    
    if (!data.success) {
      throw new Error(data.error || 'Failed to fetch template');
    }

    // Populate and show modal
    document.getElementById('modal-title').textContent = `Generated ${data.filename}`;
    document.getElementById('modal-code').textContent = data.content;
    document.getElementById('preview-modal').style.display = 'flex';
  } catch (err) {
    alert('Failed to retrieve blueprint preview: ' + err.message);
  }
}

function hideModal() {
  document.getElementById('preview-modal').style.display = 'none';
}

function setupFilters() {
  const btns = document.querySelectorAll('.filter-btn');
  btns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      btns.forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      const filter = e.target.dataset.filter;
      if (currentAuditData) {
        renderIssues(currentAuditData.allIssues, filter);
      }
    });
  });
}

function renderIssues(issues, filter) {
  const container = document.getElementById('issues-list');
  container.innerHTML = '';

  const filtered = filter === 'ALL' ? issues : issues.filter(i => i.type === filter);

  if (filtered.length === 0) {
    container.innerHTML = `<div class="issue-item"><span class="issue-msg">No findings matching filter "${filter}".</span></div>`;
    return;
  }

  filtered.forEach(issue => {
    const item = document.createElement('div');
    item.className = `issue-item ${issue.type}`;

    item.innerHTML = `
      <span class="issue-type">${issue.type}</span>
      <span class="issue-msg"><strong>[${issue.category}]</strong> ${issue.message}</span>
    `;

    container.appendChild(item);
  });
}
