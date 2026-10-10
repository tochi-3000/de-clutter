const QueryCompiler = require('./QueryCompiler.js');
const Config = require('./Config.js');

function runTests() {
  console.log('--- Running Slice 1 Mechanical Verification ---');
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

  // TC-1: Normal Rule with Quoted Phrase & OR
  const r1 = QueryCompiler.compileRule({
    SenderPattern: 'notifications@bank.com',
    Keywords: '"verification code" OR "otp"',
    RetentionDays: 7,
    ProtectStarred: true
  });
  assert('TC-1: Valid email and quoted phrase compilation', 
    r1.query === 'from:(notifications@bank.com) ("verification code" OR "otp") older_than:7d -in:trash -in:spam -label:Declutter-Exempt -is:starred',
    r1
  );

  // TC-2: Wildcard domain sender & simple keyword
  const r2 = QueryCompiler.compileRule({
    SenderPattern: '@marketing.store.com',
    Keywords: 'discount newsletter',
    RetentionDays: 30,
    ProtectStarred: true
  });
  assert('TC-2: Wildcard domain sender and multiple unquoted keywords', 
    r2.query === 'from:(@marketing.store.com) (discount newsletter) older_than:30d -in:trash -in:spam -label:Declutter-Exempt -is:starred',
    r2
  );

  // TC-3: Injection neutralization: Unbalanced parentheses & wildcard from
  const r3 = QueryCompiler.compileRule({
    SenderPattern: 'promo@store.com',
    Keywords: ') OR (from:*',
    RetentionDays: 14,
    ProtectStarred: true
  });
  assert('TC-3: Neutralizes unbalanced parentheses and operator injection',
    !r3.query.includes(') OR (from:*') && !r3.query.includes('from:*') && r3.query.startsWith('from:(promo@store.com)'),
    r3
  );

  // TC-4: Injection neutralization: Operator injection (to:, label:)
  const r4 = QueryCompiler.compileRule({
    SenderPattern: 'alerts@service.com',
    Keywords: 'to:victim@domain.com label:inbox',
    RetentionDays: 1,
    ProtectStarred: true
  });
  // Colon must be stripped so "to:" cannot act as a Gmail search field operator
  assert('TC-4: Neutralizes colon operators in keywords',
    !r4.query.includes('to:') && !r4.query.includes('label:inbox') && r4.query.includes('(tovictim@domain.com labelinbox)'),
    r4
  );

  // TC-5: Starred protection toggle
  const r5 = QueryCompiler.compileRule({
    SenderPattern: 'updates@github.com',
    Keywords: 'release',
    RetentionDays: 5,
    ProtectStarred: false
  });
  assert('TC-5: Correctly omits -is:starred when ProtectStarred is false',
    !r5.query.includes('-is:starred') && r5.query.includes('older_than:5d'),
    r5
  );

  // TC-6: Input validation: Blank sender
  const r6 = QueryCompiler.compileRule({
    SenderPattern: '   ',
    RetentionDays: 5
  });
  assert('TC-6: Rejects blank sender with validation error',
    r6.query === null && r6.error.includes('empty'),
    r6
  );

  // TC-7: Input validation: Retention < 1
  const r7 = QueryCompiler.compileRule({
    SenderPattern: 'user@domain.com',
    RetentionDays: 0
  });
  assert('TC-7: Rejects retention period < 1 with validation error',
    r7.query === null && r7.error.includes('Retention days'),
    r7
  );

  console.log(`\nResults: ${passed} passed, ${failed} failed.`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
