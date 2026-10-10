/**
 * Declutter: Production Implementation
 * File: Config.js
 * Description: Global configuration, immutable limits, schema column indices, and system constants.
 */

// eslint-disable-next-line no-var
var Config = {
  SHEET_NAMES: {
    RULES: 'Rules',
    LOGS: 'Logs',
    QUICKSTART: 'QuickStart'
  },

  // Execution Safety Limits
  WATCHDOG_LIMIT_MS: 270000, // 4.5 minutes soft ceiling before 6-minute Apps Script hard termination
  LOCK_TIMEOUT_MS: 10000,    // 10 seconds mutex acquisition timeout
  SEARCH_CHUNK_SIZE: 100,    // Maximum threads fetched per search pagination step
  BATCH_TRASH_SIZE: 50,      // Maximum threads mutated per GmailApp.moveThreadsToTrash call

  // Spreadsheet Performance & Log Hygiene
  LOG_ROTATION_THRESHOLD: 6000,  // Trigger rotation when total rows exceed 6,000
  LOG_ROTATION_PURGE_COUNT: 1000, // Number of oldest rows to delete in a single contiguous slice

  // Gmail Label System
  EXEMPT_LABEL: 'Declutter-Exempt',
  RUN_LABEL_PREFIX: 'Declutter/Trashed-',

  // Domain Constants & Enums
  RULE_STATUS: {
    ACTIVE: 'ACTIVE',
    PAUSED: 'PAUSED'
  },

  EXEC_MODE: {
    DRY_RUN: 'DRY_RUN',
    LIVE: 'LIVE'
  },

  LOG_ACTION: {
    WOULD_TRASH: 'WOULD_TRASH',
    TRASHED: 'TRASHED',
    RESTORED: 'RESTORED'
  },

  // Column Headers
  RULES_HEADERS: [
    'RuleID',
    'SenderPattern',
    'Keywords',
    'RetentionDays',
    'ProtectStarred',
    'DryRun',
    'Status'
  ],

  LOGS_HEADERS: [
    'Timestamp',
    'RunID',
    'RuleID',
    'Sender',
    'Subject',
    'ReceivedDate',
    'ThreadID',
    'Mode',
    'Action'
  ]
};

// Node.js test environment export support
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Config;
}
