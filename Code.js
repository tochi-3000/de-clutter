/**
 * Declutter: Production Implementation
 * File: Code.js
 * Description: Google Apps Script container entry point, spreadsheet menu, and RPC dispatchers.
 */

/**
 * Triggered automatically when the spreadsheet is opened.
 * Adds the Declutter custom menu to the Google Sheets UI.
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🚀 Declutter')
    .addItem('Control Panel', 'showSidebar')
    .addSeparator()
    .addItem('Run Declutter (Manual)', 'menuRunDeclutter')
    .addItem('Undo Last Run (All)', 'menuUndoLastRun')
    .addItem('Restore Selected Rows from Logs', 'menuRestoreSelectedRows')
    .addSeparator()
    .addItem('Setup / Reset Daily Automation', 'menuSetupDailyAutomation')
    .addItem('Refresh QuickStart Guide', 'menuRefreshQuickStart')
    .addToUi();

  // Automatically enforce tab hygiene and focus the QuickStart onboarding guide
  try {
    SheetStore.initSheets();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (ss && ss.getSheetByName && ss.setActiveSheet) {
      const qsSheet = ss.getSheetByName(Config.SHEET_NAMES.QUICKSTART);
      if (qsSheet) {
        ss.setActiveSheet(qsSheet);
      }
    }
  } catch (e) {
    // Simple trigger error safety: never break menu rendering if sheet activation encounters sandbox limits
  }
}

/**
 * Launches the responsive Gmail-native sidebar control panel.
 */
function showSidebar() {
  SheetStore.initSheets();
  const html = HtmlService.createHtmlOutputFromFile('Sidebar')
    .setTitle('Declutter Control Panel')
    .setWidth(340);
  SpreadsheetApp.getUi().showSidebar(html);
}

/**
 * Automated trigger handler invoked by the daily 2:00 AM clock trigger.
 */
function runDeclutterAutomated() {
  return ExecutionEngine.execute({
    dryRunOverride: false,
    manualTrigger: false
  });
}

/**
 * Menu action: Trigger manual cleanup directly from menu.
 */
function menuRunDeclutter() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert(
    'Run Declutter',
    'Do you want to run Declutter now across all active rules?\n\n(Note: Rules with DryRun enabled will simulate only).',
    ui.ButtonSet.YES_NO
  );

  if (response === ui.Button.YES) {
    const result = ExecutionEngine.execute();
    if (result.success && result.result) {
      const data = result.result;
      ui.alert(
        'Declutter Completed',
        `Run ID: ${data.runId}\nMatched: ${data.totalMatched} threads\nTrashed: ${data.totalTrashed} threads\nDuration: ${(data.durationMs / 1000).toFixed(1)}s`,
        ui.ButtonSet.OK
      );
    } else {
      ui.alert('Declutter Alert', result.error || 'Execution encountered an issue.', ui.ButtonSet.OK);
    }
  }
}

/**
 * Menu action: 1-Click rollback from menu.
 */
function menuUndoLastRun() {
  const ui = SpreadsheetApp.getUi();
  const meta = SheetStore.getLatestRunMetadata();

  if (!meta || !meta.runId) {
    ui.alert('Undo Declutter', 'No existing run', ui.ButtonSet.OK);
    return;
  }

  const response = ui.alert(
    'Undo Declutter Run',
    `Restore all threads from run ${meta.runId} (${meta.threadCount} threads) back to your Inbox?`,
    ui.ButtonSet.YES_NO
  );

  if (response === ui.Button.YES) {
    const result = RollbackManager.undoLastRun(meta.runId);
    if (result.success) {
      const data = result.result || result;
      ui.alert('Undo Completed', data.message || `Restored ${data.restoredCount} threads to Inbox.`, ui.ButtonSet.OK);
    } else {
      ui.alert('Undo Alert', result.message || result.error || 'No existing run', ui.ButtonSet.OK);
    }
  }
}

/**
 * Menu action: Restores specific threads selected by the user in the Logs sheet.
 * Defensively sanitizes row selections, verifies run boundaries, and prevents accidental re-restores.
 */
function menuRestoreSelectedRows() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const activeSheet = ss.getActiveSheet();

  // Guard 1: Must be on Logs tab
  if (activeSheet.getName() !== Config.SHEET_NAMES.LOGS) {
    ui.alert(
      'Restore Selected Rows',
      `Please switch to the "${Config.SHEET_NAMES.LOGS}" tab and select the rows you wish to restore.`,
      ui.ButtonSet.OK
    );
    return;
  }

  const selection = activeSheet.getActiveRangeList();
  const ranges = selection ? selection.getRanges() : [activeSheet.getActiveRange()];
  if (!ranges || ranges.length === 0) {
    ui.alert('Restore Selected Rows', 'No rows selected.', ui.ButtonSet.OK);
    return;
  }

  // Collect unique selected row indices (1-indexed)
  const selectedRowIndices = new Set();
  for (const r of ranges) {
    if (!r) continue;
    const startRow = r.getRow();
    const numRows = r.getNumRows();
    for (let i = 0; i < numRows; i++) {
      const rowIndex = startRow + i;
      if (rowIndex > 1) { // Skip header row 1
        selectedRowIndices.add(rowIndex);
      }
    }
  }

  if (selectedRowIndices.size === 0) {
    ui.alert('Restore Selected Rows', 'No data rows selected (header row ignored).', ui.ButtonSet.OK);
    return;
  }

  // Batch read the required data from the sheet
  const lastRow = activeSheet.getLastRow();
  const validRows = Array.from(selectedRowIndices).filter(r => r <= lastRow);
  if (validRows.length === 0) {
    ui.alert('Restore Selected Rows', 'Selected rows contain no logged data.', ui.ButtonSet.OK);
    return;
  }

  // Extract ThreadID (Col G, idx 7), RunID (Col B, idx 2), Action (Col I, idx 9)
  const threadIdsToRestore = [];
  let runId = null;

  for (const rIdx of validRows) {
    const rowVals = activeSheet.getRange(rIdx, 1, 1, Config.LOGS_HEADERS.length).getValues()[0];
    const rRunId = rowVals[1];
    const tid = rowVals[6];
    const action = rowVals[8];

    if (tid && (action === Config.LOG_ACTION.TRASHED || action === Config.LOG_ACTION.RESTORED)) {
      threadIdsToRestore.push(String(tid).trim());
      if (!runId && rRunId) {
        runId = String(rRunId).trim();
      }
    }
  }

  if (threadIdsToRestore.length === 0) {
    ui.alert(
      'Restore Selected Rows',
      'None of the selected rows contain valid Thread IDs to restore.',
      ui.ButtonSet.OK
    );
    return;
  }

  const promptMsg = `Restore ${threadIdsToRestore.length} selected thread(s) back to your Inbox?`;
  const confirm = ui.alert('Confirm Granular Restore', promptMsg, ui.ButtonSet.YES_NO);
  if (confirm !== ui.Button.YES) {
    return;
  }

  const result = RollbackManager.restoreSpecificThreads(threadIdsToRestore, runId);
  if (result.success) {
    const data = result.result || result;
    ui.alert('Restore Completed', data.message || `Restored ${data.restoredCount} thread(s) to Inbox.`, ui.ButtonSet.OK);
  } else {
    ui.alert('Restore Failed', result.message || result.error || 'Encountered an issue during restore.', ui.ButtonSet.OK);
  }
}

/**
 * Menu action: Setup daily 2:00 AM trigger.
 */
function menuSetupDailyAutomation() {
  const ui = SpreadsheetApp.getUi();
  const res = TriggerManager.setupDailyAutomation();
  ui.alert(
    res.success ? 'Automation Scheduled' : 'Automation Error',
    res.message,
    ui.ButtonSet.OK
  );
}

/**
 * Menu action: Forces an immediate refresh of the QuickStart & Privacy Guide tab.
 */
function menuRefreshQuickStart() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const qs = ss.getSheetByName(Config.SHEET_NAMES.QUICKSTART);
  if (qs && qs.clear) {
    qs.clear();
  }
  SheetStore.initSheets();
  if (ss.setActiveSheet) {
    const qsSheet = ss.getSheetByName(Config.SHEET_NAMES.QUICKSTART);
    if (qsSheet) {
      ss.setActiveSheet(qsSheet);
    }
  }
  ui.alert('QuickStart Guide', 'The QuickStart & Privacy Guide has been refreshed, positioned first, and set as the active tab.', ui.ButtonSet.OK);
}

// ============================================================================
// RPC ENDPOINTS (Invoked from Sidebar.html via google.script.run)
// ============================================================================

/**
 * RPC: Returns system status, active rule count, and latest run metadata.
 */
function apiGetEngineStatus() {
  try {
    const { rules } = SheetStore.getActiveRules();
    const latestRun = SheetStore.getLatestRunMetadata();
    return {
      success: true,
      activeRuleCount: rules.length,
      latestRun: latestRun
    };
  } catch (err) {
    return {
      success: false,
      error: err.message || String(err)
    };
  }
}

/**
 * RPC: Saves a new or updated rule.
 */
function apiSaveRule(ruleData) {
  try {
    return SheetStore.saveRule(ruleData);
  } catch (err) {
    return {
      success: false,
      error: err.message || String(err)
    };
  }
}

/**
 * RPC: Executes Declutter run with optional dry-run override.
 */
function apiRunDeclutter(options) {
  try {
    const res = ExecutionEngine.execute(options || {});
    return res;
  } catch (err) {
    return {
      success: false,
      error: err.message || String(err)
    };
  }
}

/**
 * RPC: Restores threads from the latest execution run.
 */
function apiUndoLastRun() {
  try {
    return RollbackManager.undoLastRun();
  } catch (err) {
    return {
      success: false,
      error: err.message || String(err)
    };
  }
}

/**
 * RPC: Retrieves all threads for a specific run (or latest run) for granular review.
 */
function apiGetRunThreads(runId) {
  try {
    let targetRunId = runId;
    if (!targetRunId) {
      const latest = SheetStore.getLatestRunMetadata();
      targetRunId = latest ? latest.runId : null;
    }
    if (!targetRunId) {
      return { success: true, runId: null, threads: [] };
    }
    const threads = SheetStore.getRunThreads(targetRunId);
    return {
      success: true,
      runId: targetRunId,
      threads: threads
    };
  } catch (err) {
    return {
      success: false,
      error: err.message || String(err)
    };
  }
}

/**
 * RPC: Selectively restores specific thread IDs from Trash back to Inbox.
 */
function apiRestoreSelectedThreads(threadIds, runId) {
  try {
    return RollbackManager.restoreSpecificThreads(threadIds, runId);
  } catch (err) {
    return {
      success: false,
      error: err.message || String(err)
    };
  }
}

/**
 * RPC: Configures the daily 2:00 AM clock trigger.
 */
function apiSetupAutomation() {
  try {
    return TriggerManager.setupDailyAutomation();
  } catch (err) {
    return {
      success: false,
      error: err.message || String(err)
    };
  }
}

// Node.js test environment export support
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    onOpen,
    showSidebar,
    runDeclutterAutomated,
    menuRefreshQuickStart,
    menuRestoreSelectedRows,
    apiGetEngineStatus,
    apiSaveRule,
    apiRunDeclutter,
    apiUndoLastRun,
    apiGetRunThreads,
    apiRestoreSelectedThreads,
    apiSetupAutomation
  };
}
