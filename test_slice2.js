const Config = require('./Config.js');
const LockManager = require('./LockManager.js');
const SheetStore = require('./SheetStore.js');

function runTests() {
  console.log('--- Running Slice 2 Mechanical Verification ---');
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

  // --- Part 1: LockManager Verification ---
  // Test 1.1: Lock acquisition success
  LockManager._mockLock = {
    tryLock: (timeout) => true,
    releaseLock: () => {}
  };
  const lockSuccess = LockManager.withLock('TestOperation', () => {
    return 42;
  });
  assert('1.1: LockManager acquires lock and executes callback',
    lockSuccess.success === true && lockSuccess.result === 42,
    lockSuccess
  );

  // Test 1.2: Lock contention fallback
  LockManager._mockLock = {
    tryLock: (timeout) => false,
    releaseLock: () => {}
  };
  const lockContention = LockManager.withLock('TestContention', () => {
    return 'should not run';
  });
  assert('1.2: LockManager handles contention cleanly with user error message',
    lockContention.success === false && lockContention.contention === true && lockContention.error.includes('Another Declutter process is currently running'),
    lockContention
  );

  // --- Part 2: SheetStore Verification with In-Memory Mock Spreadsheet ---
  class MockSheet {
    constructor(name) {
      this.name = name;
      this.rows = [];
      this.frozenRows = 0;
    }
    appendRow(row) {
      this.rows.push([...row]);
    }
    setFrozenRows(n) {
      this.frozenRows = n;
    }
    getLastRow() {
      return this.rows.length;
    }
    getDataRange() {
      return {
        getValues: () => this.rows.map(r => [...r])
      };
    }
    getRange(row, col, numRows, numCols) {
      return {
        getValues: () => {
          const out = [];
          for (let r = 0; r < numRows; r++) {
            const rowIndex = row - 1 + r;
            const rData = this.rows[rowIndex] || [];
            const rowSlice = [];
            for (let c = 0; c < numCols; c++) {
              rowSlice.push(rData[col - 1 + c]);
            }
            out.push(rowSlice);
          }
          return out;
        },
        setValues: (newVals) => {
          for (let r = 0; r < newVals.length; r++) {
            const targetRowIndex = row - 1 + r;
            while (this.rows.length <= targetRowIndex) {
              this.rows.push([]);
            }
            for (let c = 0; c < newVals[r].length; c++) {
              this.rows[targetRowIndex][col - 1 + c] = newVals[r][c];
            }
          }
        }
      };
    }
    deleteRows(startRow, count) {
      // 1-indexed: delete count rows starting at startRow
      this.rows.splice(startRow - 1, count);
    }
  }

  class MockSpreadsheet {
    constructor() {
      this.sheets = {};
    }
    getSheetByName(name) {
      return this.sheets[name] || null;
    }
    insertSheet(name) {
      const s = new MockSheet(name);
      this.sheets[name] = s;
      return s;
    }
  }

  const mockSs = new MockSpreadsheet();
  SheetStore._mockSpreadsheet = mockSs;

  // Test 2.1: Initialization of default sheets
  SheetStore.initSheets();
  const rulesS = mockSs.getSheetByName(Config.SHEET_NAMES.RULES);
  const logsS = mockSs.getSheetByName(Config.SHEET_NAMES.LOGS);
  const qsS = mockSs.getSheetByName(Config.SHEET_NAMES.QUICKSTART);
  assert('2.1: SheetStore initializes Rules, Logs, and QuickStart sheets',
    rulesS !== null && logsS !== null && qsS !== null && rulesS.rows.length === 2,
    { rulesCount: rulesS ? rulesS.rows.length : 0 }
  );

  // Test 2.2: Active rule retrieval and validation
  // Add a paused rule and an invalid rule
  rulesS.appendRow(['RULE-PAUSED', 'paused@domain.com', '', 7, true, false, 'PAUSED']);
  rulesS.appendRow(['RULE-INVALID', '', '', 0, true, false, 'ACTIVE']);
  const ruleRes = SheetStore.getActiveRules();
  assert('2.2: SheetStore filters paused rules and flags validation errors',
    ruleRes.rules.length === 1 && ruleRes.rules[0].RuleID === 'RULE-EXAMPLE-1' && ruleRes.errors.length > 0,
    ruleRes
  );

  // Test 2.3: Single-call batch log buffer flushing
  const logBatch = [
    [new Date().toISOString(), 'RUN-001', 'RULE-1', 'sender1@test.com', 'Subject 1', new Date().toISOString(), 't1', 'DRY_RUN', 'WOULD_TRASH'],
    [new Date().toISOString(), 'RUN-001', 'RULE-1', 'sender2@test.com', 'Subject 2', new Date().toISOString(), 't2', 'DRY_RUN', 'WOULD_TRASH'],
    [new Date().toISOString(), 'RUN-001', 'RULE-1', 'sender3@test.com', 'Subject 3', new Date().toISOString(), 't3', 'DRY_RUN', 'WOULD_TRASH']
  ];
  const flushedCount = SheetStore.flushLogBuffer(logBatch);
  assert('2.3: SheetStore flushes batch log records into Logs sheet',
    flushedCount === 3 && logsS.rows.length === 4, // 1 header + 3 rows
    { flushedCount, totalRows: logsS.rows.length }
  );

  // Test 2.4: Latest run metadata extraction
  const meta = SheetStore.getLatestRunMetadata();
  assert('2.4: SheetStore extracts latest RunID metadata and thread count',
    meta.runId === 'RUN-001' && meta.threadCount === 3 && meta.mode === 'DRY_RUN',
    meta
  );

  // Test 2.5: Threshold log pruning when > 6,000 rows
  // Populate logs sheet up to 6,050 rows
  for (let i = 0; i < 6050; i++) {
    logsS.rows.push(['dummy-ts', 'RUN-OLD', 'R', 's@d.com', 'Sub', 'rcv', `th-${i}`, 'LIVE', 'TRASHED']);
  }
  const prePruneCount = logsS.getLastRow();
  SheetStore.pruneLogsIfNeeded();
  const postPruneCount = logsS.getLastRow();
  assert('2.5: SheetStore prunes oldest 1,000 rows when exceeding 6,000 threshold',
    prePruneCount > 6000 && postPruneCount === prePruneCount - 1000,
    { prePruneCount, postPruneCount }
  );

  console.log(`\nResults: ${passed} passed, ${failed} failed.`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
