const Config = require('./Config.js');
const LockManager = require('./LockManager.js');
const SheetStore = require('./SheetStore.js');
const RollbackManager = require('./RollbackManager.js');

function runTests() {
  console.log('--- Running Slice 4 Mechanical Verification ---');
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

  // --- Mock Gmail & SheetStore Setup ---
  class MockMessage {
    constructor(from, subject) {
      this.from = from;
      this.subject = subject;
      this.date = new Date();
    }
    getFrom() { return this.from; }
    getSubject() { return this.subject; }
    getDate() { return this.date; }
  }

  class MockThread {
    constructor(id, from, subject) {
      this.id = id;
      this.messages = [new MockMessage(from, subject)];
      this.labels = [];
      this.inTrash = true;
    }
    getId() { return this.id; }
    getMessages() { return this.messages; }
  }

  class MockGmailApp {
    constructor() {
      this.labels = {};
      this.restoredBatches = [];
      this.deletedLabels = [];
      this.trashThreads = [];
    }
    getUserLabelByName(name) {
      return this.labels[name] || null;
    }
    createLabel(name) {
      const label = {
        name: name,
        removeFromThreads: (threads) => {
          threads.forEach(t => {
            t.labels = t.labels.filter(l => l !== name);
          });
        }
      };
      this.labels[name] = label;
      return label;
    }
    deleteLabel(label) {
      this.deletedLabels.push(label.name);
      delete this.labels[label.name];
    }
    moveThreadsFromTrash(threads) {
      this.restoredBatches.push([...threads]);
      threads.forEach(t => t.inTrash = false);
    }
    search(query, start, max) {
      return this.trashThreads.filter(t => t.inTrash).slice(start, start + max);
    }
  }

  LockManager._mockLock = {
    tryLock: () => true,
    releaseLock: () => {}
  };

  // Test 4.1: Undo with no existing run
  SheetStore.getLatestRunMetadata = () => ({ runId: null });
  const noRunRes = RollbackManager.undoLastRun();
  assert('4.1: Returns "No existing run" when no run metadata exists',
    noRunRes.success === false && noRunRes.message === 'No existing run',
    noRunRes
  );

  // Test 4.2: Undo restoring 65 threads (testing 50-item batching)
  const runId = 'RUN-20261010-090000-001';
  const labelName = `${Config.RUN_LABEL_PREFIX}${runId}`;
  const mockGmail = new MockGmailApp();
  const sessionLabel = mockGmail.createLabel(labelName);

  for (let i = 0; i < 65; i++) {
    const t = new MockThread(`t-undo-${i}`, 'sender@domain.com', `Subject ${i}`);
    t.labels.push(labelName);
    mockGmail.trashThreads.push(t);
  }

  RollbackManager._mockGmail = mockGmail;
  let flushedLogs = [];
  SheetStore.flushLogBuffer = (rows) => {
    flushedLogs.push(...rows);
    return rows.length;
  };
  SheetStore.getLatestRunMetadata = () => ({ runId: runId });

  const restoreRes = RollbackManager.undoLastRun();
  assert('4.2.1: RollbackManager executes successfully and restores all 65 threads',
    restoreRes.success === true && restoreRes.result.restoredCount === 65,
    restoreRes
  );
  assert('4.2.2: Restoration executes in batches of 50 (batch sizes: 50, 15)',
    mockGmail.restoredBatches.length === 2 && mockGmail.restoredBatches[0].length === 50 && mockGmail.restoredBatches[1].length === 15,
    mockGmail.restoredBatches.map(b => b.length)
  );
  assert('4.2.3: Restored threads are marked inTrash = false',
    mockGmail.trashThreads.every(t => t.inTrash === false),
    mockGmail.trashThreads.map(t => t.inTrash)
  );
  assert('4.2.4: Session label is deleted from Gmail after restoration',
    mockGmail.deletedLabels.includes(labelName) && !mockGmail.labels[labelName],
    mockGmail.deletedLabels
  );
  assert('4.2.5: Audit logs record RESTORED action for all threads',
    flushedLogs.length === 65 && flushedLogs[0][8] === 'RESTORED' && flushedLogs[0][2] === 'ROLLBACK',
    flushedLogs[0]
  );

  console.log(`\nResults: ${passed} passed, ${failed} failed.`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
