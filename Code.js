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
  ui.createMenu('Declutter')
    .addItem('Control Panel', 'showSidebar')
    .addSeparator()
    .addItem('Run Declutter (Manual)', 'menuRunDeclutter')
    .addItem('Undo Last Run', 'menuUndoLastRun')
    .addSeparator()
    .addItem('Setup / Reset Daily Automation', 'menuSetupDailyAutomation')
    .addItem('Refresh QuickStart Guide', 'menuRefreshQuickStart')
    .addToUi();
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
  ui.alert('QuickStart Guide', 'The QuickStart & Privacy Guide has been refreshed with the latest documentation.', ui.ButtonSet.OK);
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
    apiGetEngineStatus,
    apiSaveRule,
    apiRunDeclutter,
    apiUndoLastRun,
    apiSetupAutomation
  };
}
