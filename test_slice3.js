const Config = require('./Config.js');
const QueryCompiler = require('./QueryCompiler.js');
const LockManager = require('./LockManager.js');
const SheetStore = require('./SheetStore.js');
const ExecutionEngine = require('./ExecutionEngine.js');

function runTests() {
  console.log('--- Running Slice 3 Mechanical Verification ---');
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
    constructor(from, subject, date) {
      this.from = from;
      this.subject = subject;
      this.date = date;
    }
    getFrom() { return this.from; }
    getSubject() { return this.subject; }
    getDate() { return this.date; }
  }

  class MockThread {
    constructor(id, from, subject) {
      this.id = id;
      this.messages = [new MockMessage(from, subject, new Date())];
      this.labels = [];
      this.inTrash = false;
    }
    getId() { return this.id; }
    getMessages() { return this.messages; }
  }

  class MockGmailApp {
    constructor() {
      this.labels = {};
      this.trashedBatches = [];
      this.threads = [];
    }
    getUserLabelByName(name) {
      return this.labels[name] || null;
    }
    createLabel(name) {
      const label = {
        name: name,
        taggedThreads: [],
        addToThreads: (threads) => {
          label.taggedThreads.push(...threads);
          threads.forEach(t => t.labels.push(name));
        }
      };
      this.labels[name] = label;
      return label;
    }
    moveThreadsToTrash(threads) {
      this.trashedBatches.push([...threads]);
      threads.forEach(t => t.inTrash = true);
    }
    search(query, start, max) {
      // Return matching untrashed threads
      const untrashed = this.threads.filter(t => !t.inTrash);
      return untrashed.slice(start, start + max);
    }
  }

  // Configure LockManager with always-succeeding mock lock
  LockManager._mockLock = {
    tryLock: () => true,
    releaseLock: () => {}
  };

  // Configure mock SheetStore with active test rules
  let flushedLogs = [];
  SheetStore.getActiveRules = () => {
    return {
      rules: [
        {
          RuleID: 'RULE-TEST-1',
          SenderPattern: 'promo@store.com',
          Keywords: 'discount',
          RetentionDays: 7,
          ProtectStarred: true,
          DryRun: true,
          Status: 'ACTIVE'
        }
      ],
      errors: []
    };
  };
  SheetStore.flushLogBuffer = (rows) => {
    flushedLogs.push(...rows);
    return rows.length;
  };

  // --- Test 3.1: Dry-Run Mode Verification ---
  const mockGmail1 = new MockGmailApp();
  for (let i = 0; i < 5; i++) {
    mockGmail1.threads.push(new MockThread(`t-dry-${i}`, 'promo@store.com', `Discount #${i}`));
  }
  ExecutionEngine._mockGmail = mockGmail1;

  flushedLogs = [];
  const dryRes = ExecutionEngine.execute({ dryRunOverride: true });
  assert('3.1.1: ExecutionEngine returns success in dry-run mode',
    dryRes.success === true && dryRes.result.totalMatched === 5 && dryRes.result.totalTrashed === 0,
    dryRes
  );
  assert('3.1.2: In Dry-Run mode, zero threads are moved to trash',
    mockGmail1.trashedBatches.length === 0,
    mockGmail1.trashedBatches
  );
  assert('3.1.3: In Dry-Run mode, logs are buffered with WOULD_TRASH action',
    flushedLogs.length === 5 && flushedLogs[0][8] === 'WOULD_TRASH' && flushedLogs[0][7] === 'DRY_RUN',
    flushedLogs[0]
  );

  // --- Test 3.2: Live Mode Verification with Tagging & Batch Trashing ---
  const mockGmail2 = new MockGmailApp();
  // Create 120 threads to test batch chunking of 50
  for (let i = 0; i < 120; i++) {
    mockGmail2.threads.push(new MockThread(`t-live-${i}`, 'promo@store.com', `Discount #${i}`));
  }
  ExecutionEngine._mockGmail = mockGmail2;

  flushedLogs = [];
  const liveRes = ExecutionEngine.execute({ dryRunOverride: false });
  assert('3.2.1: ExecutionEngine returns success in live mode',
    liveRes.success === true && liveRes.result.totalMatched === 120 && liveRes.result.totalTrashed === 120,
    liveRes
  );
  assert('3.2.2: Live mode creates session label Declutter/Trashed-<RunID>',
    Object.keys(mockGmail2.labels).some(k => k.startsWith('Declutter/Trashed-RUN-')),
    Object.keys(mockGmail2.labels)
  );
  assert('3.2.3: Live mode trashes in batches of 50 (3 batches for 120 items: 50, 50, 20)',
    mockGmail2.trashedBatches.length === 3 && mockGmail2.trashedBatches[0].length === 50 && mockGmail2.trashedBatches[2].length === 20,
    mockGmail2.trashedBatches.map(b => b.length)
  );
  assert('3.2.4: In Live mode, audit logs record TRASHED action with thread IDs',
    flushedLogs.length === 120 && flushedLogs[0][8] === 'TRASHED' && flushedLogs[0][6] === 't-live-0',
    flushedLogs[0]
  );

  console.log(`\nResults: ${passed} passed, ${failed} failed.`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
