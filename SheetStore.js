/**
 * Declutter: Production Implementation
 * File: SheetStore.js
 * Description: Relational Google Sheet adapter, atomic batch log flusher, row validator, and threshold log pruner.
 */

// eslint-disable-next-line no-var
var SheetStore = (function () {
  function getConfig() {
    return (typeof Config !== 'undefined') ? Config : (typeof require !== 'undefined' ? require('./Config.js') : {});
  }
  /**
   * Retrieves the active spreadsheet handle.
   * @returns {GoogleAppsScript.Spreadsheet.Spreadsheet|null}
   */
  function getSpreadsheet() {
    if (typeof SpreadsheetApp !== 'undefined') {
      return SpreadsheetApp.getActiveSpreadsheet();
    }
    return SheetStore._mockSpreadsheet || null;
  }

  /**
   * Initializes sheet tabs (Rules, Logs, QuickStart) if they do not exist.
   */
  function initSheets() {
    const _Config = getConfig();
    const ss = getSpreadsheet();
    if (!ss) return;

    // 1. Rules Sheet
    let rulesSheet = ss.getSheetByName(_Config.SHEET_NAMES.RULES);
    if (!rulesSheet) {
      rulesSheet = ss.insertSheet(_Config.SHEET_NAMES.RULES);
      rulesSheet.appendRow(_Config.RULES_HEADERS);
      rulesSheet.setFrozenRows(1);
      // Sample starter rule
      rulesSheet.appendRow([
        'RULE-EXAMPLE-1',
        '@marketing.domain.com',
        '"newsletter" OR "promo"',
        14,
        true,
        true,
        'ACTIVE'
      ]);
    }

    // 2. Logs Sheet
    let logsSheet = ss.getSheetByName(_Config.SHEET_NAMES.LOGS);
    if (!logsSheet) {
      logsSheet = ss.insertSheet(_Config.SHEET_NAMES.LOGS);
      logsSheet.appendRow(_Config.LOGS_HEADERS);
      logsSheet.setFrozenRows(1);
    }

    // 3. QuickStart Sheet
    let qsSheet = ss.getSheetByName(_Config.SHEET_NAMES.QUICKSTART);
    if (!qsSheet) {
      qsSheet = ss.insertSheet(_Config.SHEET_NAMES.QUICKSTART);
    }
    // Populate or refresh QuickStart guide content if missing the updated guide
    const headerVal = qsSheet.getLastRow() > 0 ? String(qsSheet.getRange(1, 1).getValue() || '') : '';
    if (!headerVal.includes('Automated Gmail Cleaner')) {
      if (qsSheet.clear) qsSheet.clear();
      qsSheet.appendRow(['Declutter — Automated Gmail Cleaner & Zero-Custody Privacy Guide']);
      qsSheet.appendRow(['']);

      // SECTION 1: VALUE PROPOSITION & BENEFITS
      qsSheet.appendRow(['🌟 WHAT IS DECLUTTER?']);
      qsSheet.appendRow(['Declutter is your personal, automated inbox housekeeper that runs 100% inside your Google account.']);
      qsSheet.appendRow(['It automatically finds and sweeps away promotional junk, stale newsletters, and marketing clutter based on custom rules you control.']);
      qsSheet.appendRow(['']);
      qsSheet.appendRow(['WHY DECLUTTER IS BETTER THAN COMMERCIAL CLEANERS:']);
      qsSheet.appendRow(['• 🛡️ 100% Private (Zero-Custody): Your emails, login tokens, and credentials NEVER leave your Google account. No external servers or third-party databases.']);
      qsSheet.appendRow(['• ⚡ Automated Daily Sweeps: Cleans your mailbox on autopilot every morning at 2:00 AM according to your custom retention days.']);
      qsSheet.appendRow(['• 🔄 100% Reversible (Zero Risk): Emails move to Gmail Trash (never permanently deleted) and remain recoverable for 30 days. Restore all or pick specific emails with 1 click.']);
      qsSheet.appendRow(['• ⭐️ Starred Email Protection: Starred and important emails are strictly protected and never touched.']);
      qsSheet.appendRow(['']);

      // SECTION 2: NAVIGATION & BUTTON LOCATION (ZERO AMBIGUITY)
      qsSheet.appendRow(['📍 HOW TO OPEN THE CONTROL PANEL (WHERE TO CLICK):']);
      qsSheet.appendRow(['Look directly above this sheet at the top Google Sheets menu bar (next to File, Edit, View, Insert, ..., Help):']);
      qsSheet.appendRow(['👉 Click the "🚀 Declutter" menu item  ➔  Select "Control Panel" from the dropdown list.']);
      qsSheet.appendRow(['(Alternatively, if you are on the Master Template, click the floating "🚀 OPEN DECLUTTER CONTROL PANEL" button).']);
      qsSheet.appendRow(['This opens the Declutter Control Panel sidebar on the right side of your screen.']);
      qsSheet.appendRow(['']);

      // SECTION 3: WHY GOOGLE SHOWS "GOOGLE HASN'T VERIFIED THIS APP"
      qsSheet.appendRow(['🔒 WHY GOOGLE SHOWS "GOOGLE HASN\'T VERIFIED THIS APP":']);
      qsSheet.appendRow(['When you first launch Declutter, Google will display a security warning saying "Google hasn\'t verified this app".']);
      qsSheet.appendRow(['HERE IS EXACTLY WHY THIS APPEARS AND WHY YOU HAVE ABSOLUTELY NOTHING TO WORRY ABOUT:']);
      qsSheet.appendRow(['• The $50k Audit Barrier: Google requires commercial SaaS companies to pay $15,000–$75,000 annually for an enterprise CASA audit to remove this screen.']);
      qsSheet.appendRow(['• Why commercial apps pay it: Commercial inbox cleaners (like Unroll.me or Cleanfox) pay for audits because they host your emails on external servers and monetize user purchase receipts for market research.']);
      qsSheet.appendRow(['• Why Declutter is safer: Declutter is NOT a third-party SaaS. It is an open-source, personal script that lives exclusively inside YOUR Google spreadsheet.']);
      qsSheet.appendRow(['• Zero middleman: There is NO outside company, NO server, NO database, and NO developer who can ever access your emails. You are simply authorizing YOUR OWN private spreadsheet to organize YOUR OWN Gmail account.']);
      qsSheet.appendRow(['• Google\'s "(unsafe)" label: Google automatically attaches the word "(unsafe)" to ANY personal or unverified script because Google hasn\'t audited a corporate entity. The entire source code is 100% viewable and auditable under Extensions > Apps Script.']);
      qsSheet.appendRow(['']);

      // SECTION 4: 1-TIME AUTHORIZATION WALKTHROUGH
      qsSheet.appendRow(['🚀 HOW TO COMPLETE 1-TIME AUTHORIZATION (Takes 15 seconds):']);
      qsSheet.appendRow(['1. Click the top menu: "🚀 Declutter"  ➔  "Control Panel".']);
      qsSheet.appendRow(['2. When Google displays "Authorization Required", click "Continue".']);
      qsSheet.appendRow(['3. Choose your Google account.']);
      qsSheet.appendRow(['4. On the "Google hasn’t verified this app" warning, click "Advanced" (small link at the bottom-left).']);
      qsSheet.appendRow(['5. Click "Go to Declutter Master Template (unsafe)", then click "Allow".']);
      qsSheet.appendRow(['(You only do this once on your first run. You will never need to authorize it again).']);
      qsSheet.appendRow(['']);

      // SECTION 5: HOW TO USE DECLUTTER
      qsSheet.appendRow(['⚡ HOW TO USE DECLUTTER:']);
      qsSheet.appendRow(['1. Open the sidebar via "🚀 Declutter"  ➔  "Control Panel".']);
      qsSheet.appendRow(['2. In the "Quick Rule Builder", enter a sender pattern (e.g. @marketing.store.com) and optional keywords.']);
      qsSheet.appendRow(['3. Click "Test (Dry Run)" — simulated matches will appear in the "Logs" tab with zero changes to your actual emails.']);
      qsSheet.appendRow(['4. Click "Run Declutter Now" for live cleanup — matching emails move to Gmail Trash and remain recoverable for 30 days.']);
      qsSheet.appendRow(['5. Accidental deletion? Open "Disaster Recovery" in the sidebar to "Restore All" or click "Review & Pick" to selectively restore specific emails.']);
      qsSheet.appendRow(['6. Turn on Hands-Free Automation: Click "🚀 Declutter"  ➔  "Setup / Reset Daily Automation" to clean up automatically at 2:00 AM daily.']);
      qsSheet.setFrozenRows(1);
    }

    // 4. Tab Hygiene: Remove empty default "Sheet1" if present
    const defaultSheet = ss.getSheetByName('Sheet1');
    if (defaultSheet && ss.deleteSheet) {
      const isDefaultEmpty = (typeof defaultSheet.getLastRow === 'function' ? defaultSheet.getLastRow() : 0) === 0;
      const totalSheets = ss.getSheets ? ss.getSheets().length : 2;
      if (isDefaultEmpty && totalSheets > 1) {
        try {
          ss.deleteSheet(defaultSheet);
        } catch (e) {
          // Ignore deletion error in restricted contexts
        }
      }
    }

    // 5. UX Ordering: Ensure QuickStart is the first (leftmost) tab and actively focused
    if (ss.setActiveSheet) {
      try {
        if (ss.moveActiveSheet) {
          if (qsSheet) {
            ss.setActiveSheet(qsSheet);
            ss.moveActiveSheet(1);
          }
          if (rulesSheet) {
            ss.setActiveSheet(rulesSheet);
            ss.moveActiveSheet(2);
          }
          if (logsSheet) {
            ss.setActiveSheet(logsSheet);
            ss.moveActiveSheet(3);
          }
        }
        if (qsSheet) {
          ss.setActiveSheet(qsSheet);
        }
      } catch (orderErr) {
        // Ignore ordering errors in mock or restricted environments
      }
    }
  }

  /**
   * Validates and returns active rules from the Rules tab.
   * @returns {{ rules: Array<Object>, errors: Array<string> }}
   */
  function getActiveRules() {
    const _Config = getConfig();
    const ss = getSpreadsheet();
    if (!ss) return { rules: [], errors: ['Spreadsheet unavailable'] };

    const rulesSheet = ss.getSheetByName(_Config.SHEET_NAMES.RULES);
    if (!rulesSheet) {
      initSheets();
      return { rules: [], errors: ['Rules sheet was uninitialized. Initialized now.'] };
    }

    const data = rulesSheet.getDataRange().getValues();
    if (data.length <= 1) {
      return { rules: [], errors: [] };
    }

    const rules = [];
    const errors = [];

    // Header is row 0; data starts at row 1
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const ruleId = String(row[0] || '').trim();
      const senderPattern = String(row[1] || '').trim();
      const keywords = String(row[2] || '').trim();
      const retentionDays = parseInt(row[3], 10);
      const protectStarred = row[4] === true || String(row[4]).toUpperCase() === 'TRUE';
      const dryRun = row[5] === true || String(row[5]).toUpperCase() === 'TRUE';
      const status = String(row[6] || '').trim().toUpperCase();

      if (status !== _Config.RULE_STATUS.ACTIVE) {
        continue;
      }

      // Row Validation
      if (!ruleId) {
        errors.push(`Row ${i + 1}: Missing RuleID.`);
        continue;
      }
      if (!senderPattern) {
        errors.push(`Row ${i + 1} (${ruleId}): SenderPattern cannot be empty.`);
        continue;
      }
      if (isNaN(retentionDays) || retentionDays < 1) {
        errors.push(`Row ${i + 1} (${ruleId}): RetentionDays must be an integer >= 1.`);
        continue;
      }

      rules.push({
        RuleID: ruleId,
        SenderPattern: senderPattern,
        Keywords: keywords,
        RetentionDays: retentionDays,
        ProtectStarred: protectStarred,
        DryRun: dryRun,
        Status: status
      });
    }

    return { rules: rules, errors: errors };
  }

  /**
   * Saves or updates a rule in the Rules sheet.
   * @param {Object} rule
   * @returns {{ success: boolean, ruleId: string, error?: string }}
   */
  function saveRule(rule) {
    const _Config = getConfig();
    const ss = getSpreadsheet();
    if (!ss) return { success: false, ruleId: '', error: 'Spreadsheet unavailable' };

    let rulesSheet = ss.getSheetByName(_Config.SHEET_NAMES.RULES);
    if (!rulesSheet) {
      initSheets();
      rulesSheet = ss.getSheetByName(_Config.SHEET_NAMES.RULES);
    }

    const ruleId = rule.RuleID || `RULE-${Date.now().toString().slice(-6)}`;
    const newRow = [
      ruleId,
      rule.SenderPattern,
      rule.Keywords || '',
      parseInt(rule.RetentionDays, 10) || 7,
      rule.ProtectStarred !== false,
      rule.DryRun === true,
      _Config.RULE_STATUS.ACTIVE
    ];

    rulesSheet.appendRow(newRow);
    return { success: true, ruleId: ruleId };
  }

  /**
   * Flushes an array of log records to the Logs sheet in a single atomic setValues() call.
   * @param {Array<Array<any>>} logRows
   * @returns {number} Count of appended log rows
   */
  function flushLogBuffer(logRows) {
    if (!logRows || logRows.length === 0) return 0;

    const _Config = getConfig();
    const ss = getSpreadsheet();
    if (!ss) return 0;

    let logsSheet = ss.getSheetByName(_Config.SHEET_NAMES.LOGS);
    if (!logsSheet) {
      initSheets();
      logsSheet = ss.getSheetByName(_Config.SHEET_NAMES.LOGS);
    }

    const lastRow = logsSheet.getLastRow();
    const startRow = lastRow + 1;
    const numRows = logRows.length;
    const numCols = _Config.LOGS_HEADERS.length;

    // Format check & pad rows if needed
    const validatedRows = logRows.map(row => {
      while (row.length < numCols) {
        row.push('');
      }
      return row.slice(0, numCols);
    });

    const targetRange = logsSheet.getRange(startRow, 1, numRows, numCols);
    targetRange.setValues(validatedRows);

    // Check log rotation threshold
    pruneLogsIfNeeded();

    return numRows;
  }

  /**
   * Prunes oldest log rows in a single contiguous slice if total rows exceed the rotation threshold.
   */
  function pruneLogsIfNeeded() {
    const _Config = getConfig();
    const ss = getSpreadsheet();
    if (!ss) return;

    const logsSheet = ss.getSheetByName(_Config.SHEET_NAMES.LOGS);
    if (!logsSheet) return;

    const totalRows = logsSheet.getLastRow();
    if (totalRows > _Config.LOG_ROTATION_THRESHOLD) {
      // Row 1 is header. Delete oldest 1,000 rows starting at row 2
      const rowsToDelete = Math.min(_Config.LOG_ROTATION_PURGE_COUNT, totalRows - 1);
      if (rowsToDelete > 0) {
        logsSheet.deleteRows(2, rowsToDelete);
        if (typeof Logger !== 'undefined') {
          Logger.log(`[SheetStore] Pruned ${rowsToDelete} oldest log rows. New total: ${logsSheet.getLastRow()}`);
        }
      }
    }
  }

  /**
   * Reads metadata for the most recent run from the Logs sheet.
   * @returns {{ runId: string|null, timestamp: string|null, threadCount: number, mode: string|null }}
   */
  function getLatestRunMetadata() {
    const _Config = getConfig();
    const ss = getSpreadsheet();
    if (!ss) return { runId: null, timestamp: null, threadCount: 0, mode: null };

    const logsSheet = ss.getSheetByName(_Config.SHEET_NAMES.LOGS);
    if (!logsSheet) return { runId: null, timestamp: null, threadCount: 0, mode: null };

    const lastRow = logsSheet.getLastRow();
    if (lastRow <= 1) {
      return { runId: null, timestamp: null, threadCount: 0, mode: null };
    }

    // Read last row to get newest RunID
    const lastRowValues = logsSheet.getRange(lastRow, 1, 1, _Config.LOGS_HEADERS.length).getValues()[0];
    const latestRunId = lastRowValues[1]; // Col B: RunID
    const latestTimestamp = lastRowValues[0];
    const mode = lastRowValues[7]; // Col H: Mode

    if (!latestRunId) {
      return { runId: null, timestamp: null, threadCount: 0, mode: null };
    }

    // Count rows belonging to this RunID
    // Scan upwards from last row for efficiency
    let count = 0;
    const scanLimit = Math.max(2, lastRow - 500);
    const rangeData = logsSheet.getRange(scanLimit, 2, lastRow - scanLimit + 1, 1).getValues();

    for (let i = rangeData.length - 1; i >= 0; i--) {
      if (rangeData[i][0] === latestRunId) {
        count++;
      }
    }

    return {
      runId: latestRunId,
      timestamp: latestTimestamp,
      threadCount: count,
      mode: mode
    };
  }

  /**
   * Retrieves unique Gmail thread IDs recorded in the Logs sheet for a specific RunID.
   * Provides a defensive secondary recovery index if Gmail session labels are deleted, missing, or unindexed.
   *
   * @param {string} runId
   * @returns {string[]}
   */
  function getThreadIdsForRun(runId) {
    if (!runId) return [];

    const _Config = getConfig();
    const ss = getSpreadsheet();
    if (!ss) return [];

    const logsSheet = ss.getSheetByName(_Config.SHEET_NAMES.LOGS);
    if (!logsSheet) return [];

    const lastRow = logsSheet.getLastRow();
    if (lastRow <= 1) return [];

    const numRows = lastRow - 1;
    // Batch read RunID (Col B, index 2) and ThreadID (Col G, index 7)
    const runIds = logsSheet.getRange(2, 2, numRows, 1).getValues();
    const threadIds = logsSheet.getRange(2, 7, numRows, 1).getValues();

    const uniqueIds = new Set();
    for (let i = 0; i < numRows; i++) {
      if (runIds[i] && runIds[i][0] === runId && threadIds[i] && threadIds[i][0]) {
        uniqueIds.add(String(threadIds[i][0]).trim());
      }
    }

    return Array.from(uniqueIds);
  }

  /**
   * Retrieves all threads logged for a specific RunID with metadata and restoration status.
   *
   * @param {string} runId
   * @returns {Array<{ threadId: string, sender: string, subject: string, receivedDate: string, isRestoredInLog: boolean }>}
   */
  function getRunThreads(runId) {
    if (!runId) return [];

    const _Config = getConfig();
    const ss = getSpreadsheet();
    if (!ss) return [];

    const logsSheet = ss.getSheetByName(_Config.SHEET_NAMES.LOGS);
    if (!logsSheet) return [];

    const lastRow = logsSheet.getLastRow();
    if (lastRow <= 1) return [];

    const numRows = lastRow - 1;
    // Batch read all log rows
    const allRows = logsSheet.getRange(2, 1, numRows, _Config.LOGS_HEADERS.length).getValues();

    // Map restored thread IDs for this run
    const restoredSet = new Set();
    for (let i = 0; i < numRows; i++) {
      const row = allRows[i];
      if (row[1] === runId && row[8] === _Config.LOG_ACTION.RESTORED && row[6]) {
        restoredSet.add(String(row[6]).trim());
      }
    }

    // Collect unique trashed threads
    const threadMap = new Map();
    for (let i = 0; i < numRows; i++) {
      const row = allRows[i];
      if (row[1] === runId && (row[8] === _Config.LOG_ACTION.TRASHED || row[8] === _Config.LOG_ACTION.RESTORED) && row[6]) {
        const tid = String(row[6]).trim();
        if (!threadMap.has(tid)) {
          threadMap.set(tid, {
            threadId: tid,
            sender: String(row[3] || ''),
            subject: String(row[4] || '(No Subject)'),
            receivedDate: String(row[5] || ''),
            isRestoredInLog: restoredSet.has(tid)
          });
        }
      }
    }

    return Array.from(threadMap.values());
  }

  return {
    initSheets: initSheets,
    getActiveRules: getActiveRules,
    saveRule: saveRule,
    flushLogBuffer: flushLogBuffer,
    pruneLogsIfNeeded: pruneLogsIfNeeded,
    getLatestRunMetadata: getLatestRunMetadata,
    getThreadIdsForRun: getThreadIdsForRun,
    getRunThreads: getRunThreads,
    _mockSpreadsheet: null // Test hook
  };
})();

// Node.js test environment export support
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SheetStore;
}
