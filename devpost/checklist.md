---
doc: checklist
status: approved
---

# Build Checklist

Build mode: fast

## Slices

- [x] **1. Manifest, Config & Query Compiler with Safety Firewalls**
  Becomes usable: A tested, injection-proof query compiler engine that parses sender patterns, preserves exact quoted phrases (e.g. `"verification code"`), neutralizes operator breakouts, and enforces mandatory safety clauses (`-is:starred -in:trash -in:spam -label:Declutter-Exempt`).
  Why now: Bootstrapping and kernel safety first. If the query compiler leaks operators or unbalances syntax, emails could be misidentified. Testing compilation logic locally proves query safety before touching any mailbox.
  PRD ref: `prd.md > Features and Behavior > Rule Ingestion & Validation`
  Spec ref: `spec.md > Components > appsscript.json`, `spec.md > Components > Config.js`, `spec.md > Components > QueryCompiler.js`
  Build: Create `appsscript.json` (explicit least-privilege OAuth scopes), `Config.js` (system constants, limits, and schemas), and `QueryCompiler.js` (tokenized AST parser escaping operators and preserving quoted phrases).
  Verify (mechanical): Run local Node test script verifying that quoted phrases like `"verification code"` are preserved, unquoted operators (`OR`, colons, unbalanced parentheses) are neutralized, and safety filters are appended.
  Learner check: Inspect the test run output confirming clean query compilation, phrase preservation, and operator injection neutralization.
  Commit: `Add manifest, config, and hardened query compiler`

- [ ] **2. Concurrency Lock & Spreadsheet Engine (LockManager & SheetStore)**
  Becomes usable: Spreadsheet relational storage adapter (`Rules`, `Logs`, `QuickStart`), row validation, single-call batch log flushing (`setValues`), threshold 6,000-row log rotation, and 10-second mutex locking via `LockManager`.
  Why now: The engine requires concurrency safety and atomic sheet persistence before running any live Gmail mutations.
  PRD ref: `prd.md > Screens and Layout > Surface 1: The Google Sheet Data Engine`, `prd.md > States and Boundaries > Concurrency Collision State`
  Spec ref: `spec.md > Components > LockManager.js`, `spec.md > Components > SheetStore.js`, `spec.md > Data Model`
  Build: Implement `LockManager.js` (mutex locking via `LockService.getUserLock()`) and `SheetStore.js` (sheet schema initialization, row validator, batch log flusher, 6k threshold pruner).
  Verify (mechanical): Run test script validating lock acquisition fallback on contention, rule validation logic, schema formatting, and log buffer batch flushing.
  Learner check: Review the sheet schema definitions, validation constraints, and lock contention error handling.
  Commit: `Add concurrency lock manager and batch sheet storage adapter`

- [ ] **3. Execution Engine & Watchdog Chunker (ExecutionEngine.js)**
  Becomes usable: Complete dry-run simulation and live batch trashing engine that searches Gmail in 100-thread chunks, enforces the 270s watchdog limit, applies session labels (`Declutter/Trashed-<RunID>`), and moves threads to trash in batches of 50.
  Why now: Delivers the core execution engine and proves the dry-run safety gate before introducing UI and rollback handlers.
  PRD ref: `prd.md > Features and Behavior > Dry-Run Simulation`, `prd.md > Features and Behavior > Batch Trashing & Run Labeling`
  Spec ref: `spec.md > Components > ExecutionEngine.js`
  Build: Implement `ExecutionEngine.js` with 270s watchdog timer, 100-thread pagination loop, `Declutter/Trashed-<RunID>` session labeling, 50-thread bulk `moveThreadsToTrash`, and in-memory audit log buffering.
  Verify (mechanical): Run test harness verifying dry-run branch simulation, watchdog timeout calculation, batching chunk logic, and audit log generation.
  Learner check: Verify that dry-run mode simulates matches without trashing, and live mode tags and trashes in chunks.
  Commit: `Add execution engine with watchdog chunker and batch trashing`

- [ ] **4. Deterministic 1-Click Rollback Engine (RollbackManager.js)**
  Becomes usable: 1-Click disaster recovery that queries all threads in Gmail Trash tagged with `Declutter/Trashed-<RunID>`, restores them to the inbox via `GmailApp.moveThreadsFromTrash(threads)`, deletes the session label, and logs `RESTORED`.
  Why now: Completes the two-way safety loop before building user-facing UI controls.
  PRD ref: `prd.md > Features and Behavior > 1-Click Disaster Recovery (Undo Last Run)`, `prd.md > States and Boundaries > Undo Without Prior Run`
  Spec ref: `spec.md > Components > RollbackManager.js`
  Build: Implement `RollbackManager.js` with `undoLastRun()` querying trashed threads by session label, batch restoring to inbox, unlabeling, and audit logging.
  Verify (mechanical): Run test verifying rollback query synthesis (`in:trash label:Declutter/Trashed-<RunID>`), empty run handling ("No existing run"), and restoration logging.
  Learner check: Confirm the rollback query logic accurately isolates only threads from the specific run ID and restores them.
  Commit: `Add 1-click rollback disaster recovery engine`

- [ ] **5. Gmail-Native Sidebar GUI & Automation Dispatcher (Sidebar.html, Code.js, TriggerManager.js)**
  Becomes usable: Complete integrated Google Workspace application: custom `Declutter` spreadsheet menu, 2:00 AM daily clock trigger setup, and responsive Gmail-native sidebar with auto dark/light theme, rule builder, status cards, and Promise-wrapped RPC client.
  Why now: Integrates all backend engines into the user-facing interface, completing the full user journey.
  PRD ref: `prd.md > Screens and Layout > Surface 2 & Surface 3`, `prd.md > Look and Feel`
  Spec ref: `spec.md > Components > Sidebar.html`, `spec.md > Components > Code.js`, `spec.md > Components > TriggerManager.js`
  Build: Implement `Code.js` (`onOpen`, RPC endpoints), `TriggerManager.js` (daily 2:00 AM clock trigger), and `Sidebar.html` (self-contained embedded CSS, auto dark/light mode, 3 cards, Promise-wrapped `runRpc`).
  Verify (mechanical): Validate HTML/CSS structure, dark/light theme rules, RPC client promise handlers, and spreadsheet menu dispatcher bindings.
  Learner check: Open the sidebar in Google Sheets, verify the Gmail-native layout, add a rule, run dry-run, and test the undo card.
  Commit: `Add Gmail-native sidebar GUI, menu dispatcher, and trigger manager`

## Hands-on Checkpoints

- [ ] Early usable behavior explored — Slice 3 (Dry-Run & Batch Execution Engine)
- [ ] Final kick-the-tires exploration and feedback completed — Slice 5 (Complete Sidebar & Rollback Integration)

## Final Review

- [ ] Final review complete — feedback resolved and learner confirms ready to ship

## Code Tour and App Map

- [ ] Learning activity complete — guided route, focused alternative, prior practice connected, or brief recap
- [ ] Optional edit and transfer reflection addressed — offered/declined/already covered/not applicable as appropriate
- [ ] `devpost/app-map.html` generated from finished code, checked, and shown, including a project-grounded practice to reuse

Activity and evidence: [to be filled upon completion]
Route and stops: [to be filled upon completion]
Edit outcome: [to be filled upon completion]
Reflection: [to be filled upon completion]
Activity mode: [to be filled upon completion]

## Revisions

