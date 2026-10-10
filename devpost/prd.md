---
doc: prd
status: approved
---

# Declutter — Product Requirements Document

A container-bound, zero-token-custody Gmail inbox cleaner anchored in Google Sheets with deterministic retention rules and 1-click disaster recovery.
Source: `scope.md > The Unique Kernel` and `scope.md > The Core Loop`.

## The Core Journey
1. **Onboarding & First Use:** User clones the Google Sheet via the direct copy link, reads the embedded `QuickStart` tab, clicks `Declutter > Setup / Reset Daily Automation`, and completes Google's one-time container script authorization.
2. **Rule Configuration:** User launches `Declutter > Control Panel`. The sidebar renders in their system's dark or light theme with Gmail-native styling. The user inputs sender patterns, quoted keywords, and retention days, then clicks "Save & Test (Dry Run)".
3. **Dry-Run Simulation:** The engine queries Gmail safely without modifying any messages, logs simulated matches as `WOULD_TRASH` in the `Logs` sheet tab, and updates the sidebar with match statistics.
4. **Live Execution (Manual or Automated):** User toggles live mode and clicks "Run Declutter Now", or allows the background 2:00 AM clock trigger to execute. The engine applies an ephemeral run tag (`Declutter/Trashed-<RunID>`), moves threads to Gmail Trash in atomic batches of 50, and records immutable thread IDs in the audit log.
5. **Disaster Recovery (Undo):** If an accidental email trashing occurs, the user clicks "Undo Last Run" in the sidebar. The system immediately locates all threads tagged with that specific `RunID`, restores them back to the inbox, and logs the restoration event.

## Screens and Layout

### Surface 1: The Google Sheet Data Engine
- **Tab 1: `Rules`**
  - Interactive table where users view and configure active rules.
  - Columns: `RuleID` | `SenderPattern` | `Keywords` | `RetentionDays` | `ProtectStarred` | `DryRun` | `Status`.
- **Tab 2: `Logs`**
  - Append-only audit record of every trashing, dry-run simulation, and rollback event.
  - Columns: `Timestamp` | `RunID` | `RuleID` | `Sender` | `Subject` | `ReceivedDate` | `ThreadID` | `Mode` | `Action`.
- **Tab 3: `QuickStart`**
  - In-sheet visual onboarding guide explaining container authorization and unverified app bypass steps.

### Surface 2: Custom Spreadsheet Menu (`Declutter`)
- `Control Panel`: Launches the sidebar.
- `Run Declutter (Manual)`: Triggers a direct execution without opening the sidebar.
- `Undo Last Run`: Triggers instant rollback dialog for the most recent run.
- `Setup / Reset Daily Automation`: Programmatically registers the daily 2:00 AM clock trigger.

### Surface 3: Responsive Sidebar Control Panel
Stacked vertically into three distinct Gmail-styled functional cards:
1. **Engine Status & Run Card:**
   - Displays execution health, last run timestamp, count of active rules.
   - Master "Dry Run All" switch.
   - Primary "Run Declutter Now" action button.
2. **Quick Rule Builder:**
   - Input fields: Target Sender (email/domain), Phrase Keywords (e.g., `"verification code"`), Retention Days (slider/number), Protect Starred (checkbox).
   - "Test Rule (Dry Run)" and "Save Rule" actions.
3. **Disaster Recovery (Undo) Card:**
   - Prominently styled card displaying the latest `RunID`, execution timestamp, and thread count.
   - Distinct "Undo Last Run" danger/recovery button.

## Look and Feel
- **Visual Identity:** Gmail-Native Design. Built to feel seamlessly embedded within the Google Workspace ecosystem rather than an external web widget.
- **Typography:** Google Sans / Roboto system font stack, crisp typography hierarchy, subtle divider lines matching Google Sheets sidebars.
- **Theme Adaptation:** Dynamic Dark/Light mode automatically calibrated to the user's system theme (`prefers-color-scheme`).
- **Color Palette:**
  - Background: Slate / Workspace off-white (`#f8fafc` light, `#0f172a` dark).
  - Cards & Borders: Google Material elevation cards with `#e2e8f0` light / `#334155` dark borders.
  - Primary Action: Google Blue (`#1a73e8` light, `#38bdf8` dark).
  - Success / Safe Action: Emerald / Teal (`#10b981`).
  - Simulation / Notice: Amber badge pills (`#f59e0b`).
  - Disaster Recovery / Danger: Crimson (`#ef4444`).

## Features and Behavior

### Rule Ingestion & Validation
- Validates sender format against standard email or `@domain.tld` wildcard.
- Validates retention period ($\ge 1$ integer).
- Sanitizes and escapes operator injection while preserving double-quoted keyword phrases.
- **Acceptance Criteria:**
  - [ ] Reject blank sender with error notification: "Sender pattern cannot be empty."
  - [ ] Reject retention days $< 1$ with error notification: "Retention period must be at least 1 day."
  - [ ] Quoted search phrases like `"login code"` correctly compile into exact phrase queries without syntax errors.

### Dry-Run Simulation
- Matches emails against compiled queries with safety clauses (`-is:starred`, `-in:trash`, `-in:spam`, `-label:Declutter-Exempt`).
- Appends audit logs marked `WOULD_TRASH` with `ThreadID` recorded.
- **Acceptance Criteria:**
  - [ ] Matching threads are never moved to trash.
  - [ ] Log sheet displays simulated matches with status `WOULD_TRASH`.
  - [ ] Sidebar displays match count and dry-run summary.

### Batch Trashing & Run Labeling
- Generates a unique monotonic `RunID` (e.g., `RUN-20261010-083000`).
- Applies Gmail label `Declutter/Trashed-<RunID>` to matching threads.
- Moves threads to Gmail Trash in chunks of 50.
- Flushes audit log rows to the `Logs` sheet in a single batch.
- **Acceptance Criteria:**
  - [ ] All matching threads appear in Gmail Trash tagged with `Declutter/Trashed-<RunID>`.
  - [ ] Starred emails and emails tagged `Declutter-Exempt` remain untouched in the inbox.
  - [ ] Logs sheet records exact thread IDs with action `TRASHED`.

### 1-Click Disaster Recovery (Undo Last Run)
- Finds all threads tagged with the latest `RunID` currently in Gmail Trash.
- Restores them back to the inbox via `GmailApp.moveThreadsFromTrash(threads)`.
- Removes the ephemeral `Declutter/Trashed-<RunID>` label.
- Appends `RESTORED` events to the audit log and updates the sidebar state.
- **Acceptance Criteria:**
  - [ ] Trashed threads from the latest run are restored to the inbox immediately.
  - [ ] The `Declutter/Trashed-<RunID>` label is removed.
  - [ ] Audit log updates to reflect restoration.

## States and Boundaries

- **First Use State:**
  - `Rules` sheet contains default commented examples; `Logs` sheet is clean with frozen headers.
  - Sidebar shows: "No active rules. Add a rule below to get started."
  - Undo card displays: "No existing run".
- **Zero Match State (Empty Search):**
  - If a run matches 0 emails across all active rules, the sidebar displays:
    > "No matching emails found. Please adjust filters and try again."
  - No empty run label is created, and no bogus log entry is written.
- **Undo Without Prior Run:**
  - If a user clicks "Undo Last Run" when no run has executed or the latest run was already undone, the sidebar displays:
    > "No existing run"
- **Concurrency Collision State:**
  - If a manual run is triggered while a trigger job holds the lock, the engine terminates immediately and logs:
    > "Another Declutter process is currently running. Please try again shortly."
- **Execution Watchdog Limit:**
  - If processing exceeds 270,000 ms (4.5 minutes), execution stops gracefully, flushes all buffered logs, and outputs:
    > "Execution time budget reached. Flushed processed threads; remaining backlog will process during the next scheduled cycle."
- **Log Rotation Threshold:**
  - When row count exceeds 6,000, oldest 1,000 rows are deleted in one operation, keeping sheet size around 5,000 rows.

## Product Decisions
- **Container-Bound Script over Hosted SaaS:** Retains zero OAuth token custody and avoids $15k–$75k CASA verification audits.
- **Gmail-Native Visuals:** Uses Google Sans / Roboto and Workspace styling so users feel completely at home within Gmail/Sheets.
- **System-Calibrated Theming:** Supports both Dark and Light modes dynamically to honor individual workspace preferences.
- **1-Click Rollback via Session Labeling:** Guarantees zero risk of accidental permanent data loss.
- **Deterministic Rules over AI LLMs:** Provides free, instantaneous, 100% private, and deterministic email decluttering.

## What We're Building (POC Scope)
- Complete Google Sheet schema (`Rules`, `Logs`, `QuickStart`).
- Custom spreadsheet menu (`onOpen`).
- Responsive PicoCSS sidebar with Gmail-native aesthetic, dark/light theme, and 3 functional cards.
- Core engine with Concurrency Mutex (`LockService`), structured query compiler, watchdog timer, dry-run mode, and batch trashing (50/batch).
- Deterministic 1-click Undo recovery engine (`moveThreadsFromTrash`).
- Daily 2:00 AM clock trigger setup routine.
- Threshold log rotation routine at 6,000 rows.

## Deferred From the POC
- Custom label archiving (moving to archive labels rather than trash).
- Advanced visual filter builder (attachment size, read/unread status).
- Automated weekly email digest report.

## Non-Goals
- Centralized multi-user cloud web app (violates zero token custody).
- LLM email content interpretation (adds latency, costs, and privacy exposure).
- Permanent hard-deletion via `Gmail.Users.Messages.remove` (strictly forbidden to preserve safety).

## Open Questions
None blocking technical specification. All product behaviors, layout cards, theme choices, error banners, and edge-case boundaries are resolved.
