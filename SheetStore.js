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
    // Populate or refresh QuickStart guide content
    if (qsSheet.getLastRow() <= 10) {
      if (qsSheet.clear) qsSheet.clear();
      qsSheet.appendRow(['Declutter — Zero-Custody Privacy & Onboarding Guide']);
      qsSheet.appendRow(['']);
      qsSheet.appendRow(['🔒 WHY GOOGLE SHOWS "GOOGLE HASN\'T VERIFIED THIS APP":']);
      qsSheet.appendRow(['• 100% Private & Container-Bound: Declutter executes entirely inside YOUR Google account.']);
      qsSheet.appendRow(['• Zero Token Custody: No external servers or third-party databases ever touch your emails or tokens.']);
      qsSheet.appendRow(['• Bypassing the $50k Audit: Google mandates a $15,000–$75,000 annual third-party audit (CASA) to remove this screen for commercial SaaS.']);
      qsSheet.appendRow(['• Independent & Verifiable: As a personal script, you get enterprise-grade mailbox cleanup without corporate tracking.']);
      qsSheet.appendRow(['']);
      qsSheet.appendRow(['🚀 HOW TO COMPLETE 1-TIME AUTHORIZATION:']);
      qsSheet.appendRow(['1. Click menu "Declutter > Control Panel" (or "Setup / Reset Daily Automation").']);
      qsSheet.appendRow(['2. When Google displays "Authorization Required", click "Continue".']);
      qsSheet.appendRow(['3. On the "Google hasn’t verified this app" warning, click "Advanced" (bottom-left link).']);
      qsSheet.appendRow(['4. Click "Go to Declutter Master Template (unsafe)" and then click "Allow".']);
      qsSheet.appendRow(['']);
      qsSheet.appendRow(['⚡ HOW TO USE DECLUTTER:']);
      qsSheet.appendRow(['1. Open the sidebar via "Declutter > Control Panel".']);
      qsSheet.appendRow(['2. In the "Quick Rule Builder", enter a sender pattern and optional quoted phrases (e.g. "otp" OR "code").']);
      qsSheet.appendRow(['3. Click "Test (Dry Run)" — simulated matches will appear in the "Logs" tab without modifying any emails.']);
      qsSheet.appendRow(['4. Click "Run Declutter Now" for live cleanup (emails move to Gmail Trash and remain recoverable for 30 days).']);
      qsSheet.appendRow(['5. Accidental deletion? Click "Undo Last Run" in the sidebar to restore all threads back to your Inbox instantly.']);
      qsSheet.appendRow(['6. Click "Declutter > Setup / Reset Daily Automation" to enable hands-free daily cleanups at 2:00 AM.']);
      qsSheet.setFrozenRows(1);
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

  return {
    initSheets: initSheets,
    getActiveRules: getActiveRules,
    saveRule: saveRule,
    flushLogBuffer: flushLogBuffer,
    pruneLogsIfNeeded: pruneLogsIfNeeded,
    getLatestRunMetadata: getLatestRunMetadata,
    _mockSpreadsheet: null // Test hook
  };
})();

// Node.js test environment export support
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SheetStore;
}
