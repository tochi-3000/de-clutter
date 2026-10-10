---
doc: spec
status: approved
---

# Declutter — Technical Specification

## How This Works, In Plain Language
Declutter is a decentralized mailbox cleaner embedded directly inside a Google Sheet. Instead of sending personal emails or OAuth access tokens to an external server, all code executes privately within Google's own cloud environment via Google Apps Script (V8 runtime).

The system consists of five tightly coordinated pieces:
1. **The Spreadsheet Database (`SheetStore`):** Holds user retention rules (sender patterns, keywords, retention days) in the `Rules` tab and maintains an append-only audit trail in the `Logs` tab.
2. **The Concurrency Mutex (`LockManager`):** Uses Google's `LockService` to ensure a manual cleanup run and an automated 2:00 AM daily cron trigger never execute simultaneously.
3. **The Structured Query Compiler (`QueryCompiler`):** Translates user rules into safe, injection-proof Gmail queries. It preserves exact quoted phrases (e.g., `"verification code"`), neutralizes operator injections (colons, unbalanced parentheses), and enforces non-negotiable safety filters (`-is:starred`, `-in:trash`, `-in:spam`, `-label:Declutter-Exempt`).
4. **The Execution & Rollback Engine (`ExecutionEngine` & `RollbackManager`):** Searches Gmail in safe 100-thread chunks, enforces a 4.5-minute (270s) watchdog ceiling before Apps Script's hard 6-minute cutoff, tags matched threads with an ephemeral run label (`Declutter/Trashed-<RunID>`), moves them to trash in atomic batches of 50, and allows 1-click restoration back to the inbox.
5. **The Gmail-Native Sidebar (`Sidebar.html` & `Code.js`):** A self-contained, responsive interface embedded into Google Sheets that auto-calibrates to system dark or light mode, uses promise-wrapped RPC calls to talk to the engine, and provides status indicators, quick rule editing, and disaster recovery.

## The Core Journey Through the System
Implements `prd.md > The Core Journey`.
1. **User Clones & Authorizes:** User copies the template sheet. When clicking `Declutter > Setup / Reset Daily Automation`, `TriggerManager.js` creates a daily 2:00 AM clock trigger (`ScriptApp.newTrigger`).
2. **User Opens Sidebar:** Clicks `Declutter > Control Panel`. `Code.js` invokes `HtmlService.createHtmlOutputFromFile('Sidebar')`. The sidebar client runs `runRpc('apiGetEngineStatus')` to fetch active rule count, engine health, and last run details from `SheetStore.js`.
3. **User Tests / Adds Rule:** User inputs sender and phrase keywords in the Quick Rule Builder and clicks "Test (Dry Run)". The client calls `apiSaveRule` and `apiRunDeclutter({ dryRun: true })`. `LockManager.js` acquires a user lock, `QueryCompiler.js` compiles the query, `ExecutionEngine.js` matches threads, and `SheetStore.js` flushes `WOULD_TRASH` audit rows.
4. **Automated or Manual Live Execution:** When executed in live mode, `ExecutionEngine.js` generates `RunID` (e.g. `RUN-20261010-083000`), creates Gmail Label `Declutter/Trashed-<RunID>`, applies it to matched threads, and calls `GmailApp.moveThreadsToTrash()` in batches of 50. Thread IDs and `TRASHED` events are flushed to `Logs`.
5. **1-Click Rollback:** User clicks "Undo Last Run". The client calls `apiUndoLastRun`. `RollbackManager.js` finds threads matching `in:trash label:Declutter/Trashed-<RunID>`, calls `GmailApp.moveThreadsFromTrash()`, deletes the run label, and logs `RESTORED`.

## Stack
- **Execution Runtime:** Google Apps Script V8 Runtime (`runtimeVersion: "V8"`).
  - *Rationale:* Native execution within user tenant; eliminates external server hosting and CASA security audit requirements.
  - [Google Apps Script Documentation](https://developers.google.com/apps-script)
- **APIs & Google Services:**
  - `GmailApp` (restricted scope: `https://www.googleapis.com/auth/gmail.modify`): Querying, batch trashing, untrashing, and label management.
  - `SpreadsheetApp` (scope: `https://www.googleapis.com/auth/spreadsheets`): Relational storage for rules, logs, and UI integration.
  - `ScriptApp` (scope: `https://www.googleapis.com/auth/script.scriptapp`): Concurrency lock management and programmatic time-driven triggers.
- **Frontend / UI:** Google Apps Script HTML Service (`HtmlService`).
  - *UI Styling:* Self-contained, embedded PicoCSS-inspired stylesheet (zero external CDN dependency, 100% private and offline-capable within Google Workspace).
  - *Client Communication:* Native `google.script.run` wrapped in ES6 `Promise` client utility (`runRpc`).

## Where It Runs and How Someone Tries It
- **Runtime:** Container-bound script inside a Google Sheet running in the user's browser / Google Workspace account.
- **Prerequisites:** Any standard Google account (Gmail or Google Workspace). No Node.js, CLI, or API keys required.
- **Startup / Demo Instructions:**
  1. Open the Declutter Google Sheet template.
  2. Click custom menu: `Declutter > Control Panel`.
  3. Under the Quick Rule Builder card, enter a test sender or keyword (e.g., `"verification code"`), set retention to 1 day, and click "Test (Dry Run)".
  4. View the simulated matches in the `Logs` sheet tab.
  5. Click "Run Declutter Now" to execute live batch trashing. Verify emails moved to Gmail Trash with session label `Declutter/Trashed-<RunID>`.
  6. Click "Undo Last Run" in the sidebar. Verify all threads are immediately restored to the inbox.
- **Hackathon Submission Plan:** Short 60-second video recording of the demo flow above, published alongside the public GitHub repository containing all source scripts and documentation.

## Look and Feel
Implements `prd.md > Look and Feel`.
- **Theme:** Dynamic adaptation using `@media (prefers-color-scheme: dark)` supporting dark mode (Slate `#0f172a`, cards `#1e293b`) and light mode (Workspace off-white `#f8fafc`, cards `#ffffff`).
- **Typography:** Google Sans / Roboto system font stack.
- **Components:** Elevation cards, clean divider lines, pill badges (Amber for Dry-Run, Emerald for Active, Crimson for Undo/Trash).
- **Styling Architecture:** 100% self-contained embedded CSS inside `Sidebar.html` with zero external network requests.

## Components

### 1. `appsscript.json`
- Manifest declaring explicit least-privilege OAuth scopes: `gmail.modify`, `spreadsheets`, `script.scriptapp`, `script.container.ui`. Disallows unconstrained cloud scopes.
- Ref: `prd.md > Features and Behavior`.

### 2. `Config.js`
- Declares immutable configuration values:
  - `SHEET_NAMES`: `{ RULES: 'Rules', LOGS: 'Logs', QUICKSTART: 'QuickStart' }`
  - `WATCHDOG_LIMIT_MS`: `270000` (4.5 minutes)
  - `SEARCH_CHUNK_SIZE`: `100`
  - `BATCH_TRASH_SIZE`: `50`
  - `LOG_ROTATION_THRESHOLD`: `6000`
  - `LOG_ROTATION_PURGE_COUNT`: `1000`
  - `EXEMPT_LABEL`: `'Declutter-Exempt'`
- Ref: `prd.md > States and Boundaries`.

### 3. `LockManager.js`
- Implements mutex locking via `LockService.getUserLock()`.
- Provides `executeWithLock(actionName, fn)`: attempts lock acquisition for 10,000 ms. If contention occurs, logs error and returns graceful user error without throwing unhandled exceptions.
- Ref: `prd.md > States and Boundaries > Concurrency Collision State`.

### 4. `QueryCompiler.js`
- Tokenized query compiler and sanitizer:
  - Sanitizes `SenderPattern` (validates email / `@domain` wildcard, strips whitespace and control characters).
  - Sanitizes `Keywords`: preserves valid double-quoted phrases (e.g., `"verification code"`), strips dangerous characters (`\r`, `\n`, `{`, `}`, `(`, `)`), escapes standalone colons, and balances terms.
  - Appends mandatory safety filters: `older_than:<N>d -is:starred -in:trash -in:spam -label:Declutter-Exempt`.
- Ref: `prd.md > Features and Behavior > Rule Ingestion & Validation`.

### 5. `ExecutionEngine.js`
- Core runner managing rule execution:
  - Iterates through active rules from `SheetStore.js`.
  - Enforces 4.5-minute execution budget against `startTime`.
  - Paginates Gmail queries in chunks of 100 (`GmailApp.search(query, 0, 100)`).
  - In Live Mode: generates `RunID`, creates/gets `Declutter/Trashed-<RunID>` label, tags threads, and mutates via `GmailApp.moveThreadsToTrash()` in batches of 50.
  - In Dry-Run Mode: skips mutations, generates `WOULD_TRASH` log entries.
  - Buffers log entries in memory and flushes in a single batch call.
- Ref: `prd.md > Features and Behavior > Batch Trashing & Run Labeling`.

### 6. `RollbackManager.js`
- Disaster recovery handler:
  - Reads most recent `RunID` from `SheetStore.js` or user selection.
  - Queries `in:trash label:Declutter/Trashed-<RunID>`.
  - Calls `GmailApp.moveThreadsFromTrash(threads)` in batches of 50.
  - Removes the session label and deletes the label from Gmail.
  - Writes `RESTORED` audit events and updates sidebar state.
- Ref: `prd.md > Features and Behavior > 1-Click Disaster Recovery`.

### 7. `SheetStore.js`
- Spreadsheet I/O adapter:
  - Initializes template sheets (`Rules`, `Logs`, `QuickStart`) if missing.
  - Reads and validates active rules.
  - Appends log rows in a single atomic `range.setValues()` call.
  - Enforces log rotation: if total rows $> 6,000$, prunes oldest 1,000 rows (`sheet.deleteRows(2, 1000)`).
- Ref: `prd.md > Screens and Layout > Surface 1`.

### 8. `TriggerManager.js`
- Clock trigger manager:
  - Checks existing triggers for `runDeclutterAutomated`.
  - Clears stale duplicate triggers and registers a clean daily 2:00 AM clock trigger (`ScriptApp.newTrigger('runDeclutterAutomated').timeBased().everyDays(1).atHour(2).create()`).
- Ref: `prd.md > Screens and Layout > Surface 2`.

### 9. `Sidebar.html`
- Responsive, self-contained single-file HTML/CSS/JS frontend:
  - Embedded CSS with Google Sans / Roboto typography and dark/light mode.
  - 3 Cards: Engine Status, Quick Rule Builder, Disaster Recovery.
  - Client RPC utility (`runRpc`) wrapping `google.script.run` in native Promises with loading states and error toast handling.
- Ref: `prd.md > Screens and Layout > Surface 3`.

### 10. `Code.js`
- Apps Script entry point:
  - `onOpen()`: registers `Declutter` spreadsheet menu.
  - `showSidebar()`: opens `Sidebar.html`.
  - RPC endpoints: `apiGetEngineStatus()`, `apiSaveRule(rule)`, `apiRunDeclutter(options)`, `apiUndoLastRun()`, `apiSetupAutomation()`.
- Ref: `prd.md > Screens and Layout > Surface 2`.

## Data Model

### `Rules` Tab Schema
| Column | Header | Type | Validation / Constraints |
|---|---|---|---|
| A | `RuleID` | String | Unique ID (e.g. `RULE-1`) |
| B | `SenderPattern` | String | Valid email or `@domain.tld` |
| C | `Keywords` | String | Quoted phrases or comma-delimited |
| D | `RetentionDays` | Integer | $\ge 1$ |
| E | `ProtectStarred` | Boolean | `TRUE` / `FALSE` |
| F | `DryRun` | Boolean | `TRUE` / `FALSE` |
| G | `Status` | String | `ACTIVE` / `PAUSED` |

### `Logs` Tab Schema
| Column | Header | Type | Description |
|---|---|---|---|
| A | `Timestamp` | DateTime | ISO-8601 execution time |
| B | `RunID` | String | Monotonic ID (e.g. `RUN-20261010-083000`) |
| C | `RuleID` | String | Originating rule ID |
| D | `Sender` | String | Sender address of matched thread |
| E | `Subject` | String | Thread subject line |
| F | `ReceivedDate` | DateTime | Date of thread's last message |
| G | `ThreadID` | String | Gmail immutable thread ID |
| H | `Mode` | String | `DRY_RUN` / `LIVE` |
| I | `Action` | String | `WOULD_TRASH` / `TRASHED` / `RESTORED` |

## File Structure
```
c:\Users\HP\de-clutter\
├── appsscript.json          # Least-privilege manifest (V8 runtime, minimal OAuth scopes)
├── Code.js                  # onOpen menu, sidebar launcher, RPC dispatcher
├── Config.js                # System constants, schema maps, watchdog limits
├── LockManager.js           # Mutex wrapper using LockService.getUserLock()
├── QueryCompiler.js         # Tokenized AST query compiler & injection sanitizer
├── ExecutionEngine.js       # Watchdog loop, 100-thread chunker, 50-thread batch trasher
├── RollbackManager.js       # 1-Click Undo: finds tagged threads in trash & restores
├── SheetStore.js            # Batch setValues() log flusher & 6k threshold rotation
├── TriggerManager.js        # Programmatic 2:00 AM daily clock trigger setup
├── Sidebar.html             # Self-contained Gmail-native UI with Promise RPC client
├── Build.md                 # Hardened architectural blueprint & test matrix
├── devpost/
│   ├── learner-profile.md   # Learner technical profile & preferences
│   ├── scope.md             # Canonical approved scope
│   ├── scope.html           # Interactive visual scope companion
│   ├── prd.md               # Canonical approved PRD
│   ├── prd.html             # Interactive visual PRD companion
│   ├── spec.md              # Canonical technical specification (this document)
│   └── spec.html            # Interactive visual spec companion
└── .gitignore               # Version control ignore rules (protects credentials & profile)
```

## External Services and Dependencies
- **Google Apps Script V8 Runtime:** Built into Google Workspace; zero package managers or build steps.
- **GmailApp API:** Standard service (`gmail.modify` scope). Rate limits: 20,000 read operations / day (consumer), 50,000 (Workspace). Free.
- **SpreadsheetApp API:** Standard service (`spreadsheets` scope). Single-call batch flushing (`setValues`) minimizes API calls. Free.
- **ScriptApp API:** Standard service (`script.scriptapp` scope). Trigger and LockService management. Free.
- **Zero Third-Party Dependencies:** No external NPM packages, no third-party CDNs, and no external database servers.

## Important Failure Modes

- **Lock Contention (Manual run collides with cron trigger):**
  - *Trigger:* `LockService.getUserLock().tryLock(10000)` returns false.
  - *Fallback:* Engine aborts cleanly without corrupting state. Returns error to sidebar: `"Another Declutter process is currently running. Please try again shortly."`
- **Execution Watchdog Ceiling Hit (Large inbox backlog):**
  - *Trigger:* Run duration exceeds 270,000 ms.
  - *Fallback:* Engine breaks out of search loop, writes partial buffered logs to Sheet in a single call, and exits cleanly. Next scheduled trigger naturally processes the remainder.
- **Zero Matching Emails:**
  - *Trigger:* Rules match 0 inbox threads.
  - *Fallback:* No empty labels or bogus log rows created. Sidebar displays: `"No matching emails found. Please adjust filters and try again."`
- **Undo Clicked When No Prior Run Exists:**
  - *Trigger:* `RollbackManager` finds no previous run ID or all threads were already restored.
  - *Fallback:* Sidebar displays: `"No existing run"`.

## What Was Simplified and Why
- **Container-Bound Script instead of Centralized SaaS:** Eliminates external servers, zero token custody, and bypasses $15k–$75k CASA verification audits.
- **Deterministic Tokenized Query Compiler instead of LLM Parsing:** LLMs introduce latency, API costs, privacy risks, and non-deterministic behavior. Regex/AST compilation is instant, predictable, and 100% private.
- **Gmail Trash with 1-Click Rollback instead of Permanent Deletion (`remove`):** Permanent deletion is catastrophic on rule typos; Trash preserves Google's 30-day safety net and enables our 1-click restore engine.
- **Self-Contained Embedded CSS instead of External CDN:** Eliminates third-party CDN dependencies and prevents network loading failures inside Google Workspace.

## Decisions and Open Issues
- **Learner Choices Recorded:**
  - Self-contained embedded CSS in `Sidebar.html` over CDN.
  - Dynamic system-calibrated Dark/Light theming (`prefers-color-scheme`).
  - 270s execution watchdog with 100-thread search chunking and 50-thread batch mutations.
  - Client RPC wrapped in ES6 Promises for asynchronous `async/await` handling.
- **Learner Uncertainty Clarified:**
  - Clarified why container-bound Google Apps Script completely bypasses Google's restricted OAuth scope CASA verification audits ($15k–$75k) and eliminates third-party token custody.
- **Open Issues:** None. Ready for `5-build` step planning and implementation.

## Sharing and Submission Links
- **Public GitHub Repository:** https://github.com/tochi-3000/de-clutter
- **1-Click Clone Link:** https://docs.google.com/spreadsheets/d/1X0u6iFTzWtK58vkWq4c3UGVNRRZ-6AFyn7JhTuk3lgM/copy
- **Demo Video URL:** *(Pending upload)*
