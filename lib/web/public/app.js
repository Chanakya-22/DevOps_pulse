let currentAuditData = null;

document.addEventListener('DOMContentLoaded', () => {
  fetchAuditData();

  document.getElementById('rescan-btn').addEventListener('click', () => {
    fetchAuditData();
  });

  setupFilters();
});

async function fetchAuditData() {
  try {
    const res = await fetch('/api/audit');
    const data = await res.json();
    currentAuditData = data;
    renderDashboard(data);
  } catch (err) {
    console.error('Failed to fetch audit data:', err);
  }
}

function renderDashboard(data) {
  document.getElementById('project-path').textContent = data.projectRoot;

  // Score & Grade
  const scoreNum = document.getElementById('score-num');
  scoreNum.textContent = data.score;

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

  // Tech Stack
  const stackContainer = document.getElementById('stack-tags');
  stackContainer.innerHTML = '';
  data.structure.detectedStack.forEach(tech => {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = tech;
    stackContainer.appendChild(tag);
  });

  document.getElementById('file-stats').textContent = `${data.structure.totalFiles} files / ${data.structure.totalDirs} directories`;
  document.getElementById('cicd-provider').textContent = data.cicd.cicdProvider || 'None Detected';
  document.getElementById('lockfile-status').textContent = data.dependencies.lockfileType || 'Missing Lockfile';

  // Suggestions
  renderSuggestions(data.suggestions, data.structure.detectedStack);

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
}

function renderSuggestions(suggestions, stack) {
  const container = document.getElementById('suggestions-list');
  container.innerHTML = '';

  if (!suggestions || suggestions.length === 0) {
    container.innerHTML = '<div class="sugg-card"><p class="sugg-title">🎉 Great job! No critical fixes required.</p><p class="sugg-desc">Your pipeline configurations meet recommended best practices.</p></div>';
    return;
  }

  suggestions.forEach(sugg => {
    const card = document.createElement('div');
    card.className = 'sugg-card';

    card.innerHTML = `
      <div>
        <h3 class="sugg-title">${sugg.title}</h3>
        <p class="sugg-desc">${sugg.description}</p>
      </div>
      <button class="btn btn-primary fix-btn" data-id="${sugg.id}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
        ${sugg.actionText}
      </button>
    `;

    card.querySelector('.fix-btn').addEventListener('click', () => applyFix(sugg.id, stack));
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
    container.innerHTML = `<div class="issue-item"><span class="issue-msg">No issues matching filter "${filter}".</span></div>`;
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
