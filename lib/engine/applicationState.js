const path = require('path');

const APPLICATION_STATE_DIR = path.resolve(__dirname, '..', '..', 'data');
const AUDIT_HISTORY_PATH = path.join(APPLICATION_STATE_DIR, 'history.json');
const APPLICATION_STATE_PATHS = Object.freeze([AUDIT_HISTORY_PATH]);

module.exports = {
  APPLICATION_STATE_DIR,
  AUDIT_HISTORY_PATH,
  APPLICATION_STATE_PATHS
};