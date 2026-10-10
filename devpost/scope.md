---
doc: scope
status: approved
---

# Declutter

A container-bound, zero-token-custody Gmail inbox cleaner anchored in Google Sheets with deterministic retention rules and 1-click disaster recovery.

## The Unique Kernel
A decentralized architecture running entirely inside the user's private Google tenant that pairs an injection-proof query compiler with a deterministic, session-tagged 1-click rollback engine (`Declutter/Trashed-<RunID>`), eliminating third-party security audits and data loss risk.

## Who It's For
Non-developer professionals and privacy-conscious users drowning in thousands of promotional emails, service notifications, and expired OTPs. Today, they either spend hours manually purging pages of emails, pay for third-party SaaS services that require full inbox access tokens, or ignore inbox bloat until they hit Google storage limits.

## The Core Loop
1. Open the Declutter Google Sheet and launch the sidebar control panel.
2. Define or adjust retention rules (Sender pattern, quoted keywords, retention days, dry-run flag).
3. Test rules in Dry-Run mode to verify exact matches without touching emails.
4. Run live batch cleanup manually or let the automated daily 2:00 AM trigger handle it silently.
5. Review the append-only audit log in the Sheet, with the guarantee that any execution can be rolled back with a single click.

## Inspiration & Identity
Minimalist, utilitarian, and high-trust. Styled with PicoCSS for a lightweight, native Google Workspace sidebar look and feel. It operates like a dependable system daemon rather than a bloated commercial product.

## Why This Matters to the Learner
Solves everyday inbox fatigue without sacrificing privacy or budget: zero third-party token custody, zero compliance costs ($15k–$75k CASA audit bypass), and rock-solid architectural safeguards preventing accidental permanent email deletion.

## What "Working" Looks Like
A compelling 60-second demo:
1. User configures a rule targeting promotional/notification emails older than 7 days.
2. Executes a live batch trashing run from the sidebar.
3. Shows matching threads cleanly trashed in Gmail, tagged with session labels, and logged in the Sheet with thread IDs.
4. Clicks "Undo Last Run" in the sidebar to programmatically restore every trashed thread back to the inbox in seconds.

## The POC Boundary
- **Platform:** Container-bound Google Apps Script anchored to a Google Sheet.
- **Security:** Least-privilege OAuth scopes (`gmail.modify`, `spreadsheets`, `script.scriptapp`) and `LockService` concurrency mutex.
- **Engine:** Structured query compiler (escapes operator injections, groups boolean clauses, preserves quoted phrases like `"verification code"`).
- **Execution Safety:** 4.5-minute execution watchdog, 100-thread chunking, and 50-thread bulk mutations.
- **Reversibility:** Ephemeral session label tagging (`Declutter/Trashed-<RunID>`) and 1-click `undoLastRun` RPC restoring via `GmailApp.moveThreadsFromTrash`.
- **UI:** Responsive HTML Service sidebar with PicoCSS, custom spreadsheet menu (`onOpen`), and embedded `QuickStart` onboarding guide.
- **Automation:** Programmatic daily 2:00 AM clock trigger creation and threshold log rotation at 6,000 rows.

## Later
- Multi-folder / custom Gmail label archiving (moving to archive instead of trash).
- Advanced filter builder in the sidebar (size, attachment flags, read/unread states).
- Weekly automated email digest summarizing total emails pruned and storage reclaimed.
- Rule import/export via JSON/CSV.

## Explicitly Cut
- **Centralized Multi-Account SaaS:** Violates the zero-token-custody model, creates an external database attack surface, and triggers mandatory $15k–$75k Google CASA security audits.
- **LLM-Based Auto-Categorization:** Non-deterministic, slow, adds external API costs, and leaks email metadata to third-party AI endpoints; deterministic rules are private, instant, and free.
- **Direct Permanent Deletion (`Gmail.Users.Messages.remove`):** Completely irreversible and catastrophic if a rule contains an error; moving to Trash preserves Google's 30-day safety net and enables our 1-click rollback engine.
