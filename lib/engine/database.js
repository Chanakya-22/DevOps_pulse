const fs = require('fs');
const path = require('path');

const DB_DIR = path.join(__dirname, '..', '..', 'data');
const DB_FILE = path.join(DB_DIR, 'history.json');

function ensureDbExists() {
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify([], null, 2), 'utf-8');
  }
}

function getHistory() {
  ensureDbExists();
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

function saveAudit(auditData) {
  ensureDbExists();
  const history = getHistory();
  
  // Format history record (keep main details, score, and issues, strip huge trees if needed to save space)
  const record = {
    id: `scan-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    timestamp: auditData.timestamp || new Date().toISOString(),
    projectRoot: auditData.projectRoot,
    score: auditData.score,
    grade: auditData.grade,
    statusColor: auditData.statusColor,
    statusSummary: auditData.statusSummary,
    counts: auditData.counts,
    detectedStack: auditData.structure?.detectedStack || [],
    cicdProvider: auditData.cicd?.cicdProvider || 'None',
    // We save the full audit data so they can click and reload it
    fullData: auditData
  };

  history.unshift(record);
  
  // Cap history at 50 records to prevent file size bloat
  const capped = history.slice(0, 50);
  fs.writeFileSync(DB_FILE, JSON.stringify(capped, null, 2), 'utf-8');
  
  return record.id;
}

function getAuditById(id) {
  const history = getHistory();
  const found = history.find(r => r.id === id);
  return found ? found.fullData : null;
}

function deleteAudit(id) {
  ensureDbExists();
  const history = getHistory();
  const filtered = history.filter(r => r.id !== id);
  fs.writeFileSync(DB_FILE, JSON.stringify(filtered, null, 2), 'utf-8');
  return true;
}

module.exports = {
  getHistory,
  saveAudit,
  getAuditById,
  deleteAudit
};
