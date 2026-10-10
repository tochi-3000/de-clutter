const fs = require('fs');
const path = require('path');
const Code = require('./Code.js');
const TriggerManager = require('./TriggerManager.js');

function runTests() {
  console.log('--- Running Slice 5 Mechanical Verification ---');
  let passed = 0;
  let failed = 0;

  function assert(desc, condition, details) {
    if (condition) {
      console.log(`[PASS] ${desc}`);
      passed++;
    } else {
      console.error(`[FAIL] ${desc}`);
      if (details) console.error('       Details:', details);
      failed++;
    }
  }

  // --- Part 1: Sidebar.html Verification ---
  const sidebarContent = fs.readFileSync(path.join(__dirname, 'Sidebar.html'), 'utf8');

  // Check 1.1: HTML Structure & System Theme
  assert('5.1.1: Sidebar.html contains dynamic prefers-color-scheme dark/light rules',
    sidebarContent.includes('@media (prefers-color-scheme: dark)') && sidebarContent.includes('--bg: #0f172a'),
    null
  );

  // Check 1.2: Essential DOM Elements Present
  const requiredIds = [
    'chkDryRunAll',
    'btnRunNow',
    'inputSender',
    'inputKeywords',
    'inputRetention',
    'chkProtectStarred',
    'btnTestRule',
    'btnSaveRule',
    'latestRunId',
    'latestThreadCount',
    'btnUndo',
    'banner'
  ];
  const allIdsPresent = requiredIds.every(id => sidebarContent.includes(`id="${id}"`));
  assert('5.1.2: All required functional DOM IDs present in Sidebar.html',
    allIdsPresent,
    requiredIds.filter(id => !sidebarContent.includes(`id="${id}"`))
  );

  // Check 1.3: Promise-wrapped RPC client presence
  assert('5.1.3: Sidebar.html embeds Promise-wrapped runRpc client helper',
    sidebarContent.includes('function runRpc(fnName, ...args)') && sidebarContent.includes('new Promise'),
    null
  );

  // Check 1.4: Required product string messages present
  assert('5.1.4: Empty-match and absent-undo product strings present in Sidebar.html',
    sidebarContent.includes('No matching emails found. Please adjust filters and try again.') &&
    sidebarContent.includes('No existing run'),
    null
  );

  // --- Part 2: Code.js & TriggerManager Verification ---
  assert('5.2.1: Code.js exports required RPC entry points',
    typeof Code.apiGetEngineStatus === 'function' &&
    typeof Code.apiSaveRule === 'function' &&
    typeof Code.apiRunDeclutter === 'function' &&
    typeof Code.apiUndoLastRun === 'function' &&
    typeof Code.apiSetupAutomation === 'function',
    Object.keys(Code)
  );

  assert('5.2.2: TriggerManager exports setupDailyAutomation with correct handler name',
    typeof TriggerManager.setupDailyAutomation === 'function' &&
    TriggerManager.HANDLER_FUNCTION === 'runDeclutterAutomated',
    TriggerManager
  );

  console.log(`\nResults: ${passed} passed, ${failed} failed.`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
