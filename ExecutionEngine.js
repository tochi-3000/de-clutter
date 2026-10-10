/**
 * Declutter: Production Implementation
 * File: ExecutionEngine.js
 * Description: Core execution engine managing watchdog budgeting, chunked search, session labeling, and batch trashing.
 */

// eslint-disable-next-line no-var
var ExecutionEngine = (function () {
  const _Config = (typeof Config !== 'undefined') ? Config : (typeof require !== 'undefined' ? require('./Config.js') : {});
  const _QueryCompiler = (typeof QueryCompiler !== 'undefined') ? QueryCompiler : (typeof require !== 'undefined' ? require('./QueryCompiler.js') : {});
  const _SheetStore = (typeof SheetStore !== 'undefined') ? SheetStore : (typeof require !== 'undefined' ? require('./SheetStore.js') : {});
  const _LockManager = (typeof LockManager !== 'undefined') ? LockManager : (typeof require !== 'undefined' ? require('./LockManager.js') : {});

  /**
   * Generates a unique monotonic RunID (e.g. RUN-20261010-083000-123).
   * @returns {string}
   */
  function generateRunId() {
    const d = new Date();
    const pad = (n, len = 2) => String(n).padStart(len, '0');
    const dateStr = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
    const timeStr = `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    const msStr = pad(d.getMilliseconds(), 3);
    return `RUN-${dateStr}-${timeStr}-${msStr}`;
  }

  /**
   * Safe wrapper for GmailApp.
   */
  function getGmailService() {
    if (typeof GmailApp !== 'undefined') {
      return GmailApp;
    }
    return ExecutionEngine._mockGmail || null;
  }

  /**
   * Executes the declutter engine across all active rules.
   *
   * @param {Object} [options]
   * @param {boolean} [options.dryRunOverride]
   * @returns {{ success: boolean, runId?: string, totalMatched?: number, totalTrashed?: number, durationMs?: number, error?: string, contention?: boolean }}
   */
  function execute(options = {}) {
    return _LockManager.withLock('ExecutionEngine.execute', () => {
      const startTime = Date.now();
      const runId = generateRunId();
      const gmail = getGmailService();

      if (!gmail) {
        throw new Error('Gmail service is unavailable.');
      }

      const { rules, errors: ruleErrors } = _SheetStore.getActiveRules();
      if (rules.length === 0) {
        return {
          success: true,
          runId: runId,
          totalMatched: 0,
          totalTrashed: 0,
          durationMs: Date.now() - startTime,
          message: 'No active rules found to process.'
        };
      }

      const logBuffer = [];
      let totalMatched = 0;
      let totalTrashed = 0;
      let sessionLabel = null;
      let watchdogTriggered = false;

      for (const rule of rules) {
        // Evaluate watchdog limit
        if (Date.now() - startTime > _Config.WATCHDOG_LIMIT_MS) {
          watchdogTriggered = true;
          break;
        }

        const isDryRun = (options.dryRunOverride !== undefined) ? options.dryRunOverride : rule.DryRun;
        const execMode = isDryRun ? _Config.EXEC_MODE.DRY_RUN : _Config.EXEC_MODE.LIVE;

        // Compile query
        const { query, error: compileErr } = _QueryCompiler.compileRule(rule);
        if (compileErr || !query) {
          if (typeof Logger !== 'undefined') {
            Logger.log(`[ExecutionEngine] Skipping rule ${rule.RuleID}: ${compileErr}`);
          }
          continue;
        }

        let startIndex = 0;
        let ruleDone = false;

        while (!ruleDone) {
          // Check watchdog before querying next chunk
          if (Date.now() - startTime > _Config.WATCHDOG_LIMIT_MS) {
            watchdogTriggered = true;
            break;
          }

          const threads = gmail.search(query, startIndex, _Config.SEARCH_CHUNK_SIZE) || [];
          if (threads.length === 0) {
            break;
          }

          totalMatched += threads.length;

          // Process threads in batches of 50
          for (let i = 0; i < threads.length; i += _Config.BATCH_TRASH_SIZE) {
            const batch = threads.slice(i, i + _Config.BATCH_TRASH_SIZE);

            // Record log entries
            for (const thread of batch) {
              let sender = '';
              let subject = '';
              let receivedDate = new Date().toISOString();

              try {
                const messages = thread.getMessages();
                if (messages && messages.length > 0) {
                  const lastMsg = messages[messages.length - 1];
                  sender = lastMsg.getFrom ? lastMsg.getFrom() : '';
                  subject = lastMsg.getSubject ? lastMsg.getSubject() : '';
                  receivedDate = lastMsg.getDate ? lastMsg.getDate().toISOString() : receivedDate;
                }
              } catch (msgErr) {
                // Ignore message inspection errors
              }

              logBuffer.push([
                new Date().toISOString(),
                runId,
                rule.RuleID,
                sender,
                subject,
                receivedDate,
                thread.getId ? thread.getId() : String(Math.random()),
                execMode,
                isDryRun ? _Config.LOG_ACTION.WOULD_TRASH : _Config.LOG_ACTION.TRASHED
              ]);
            }

            // In Live mode: Tag with session label and move to trash
            if (!isDryRun) {
              if (!sessionLabel) {
                const labelName = `${_Config.RUN_LABEL_PREFIX}${runId}`;
                sessionLabel = gmail.getUserLabelByName(labelName);
                if (!sessionLabel) {
                  sessionLabel = gmail.createLabel(labelName);
                }
              }

              // Apply session label
              if (sessionLabel && sessionLabel.addToThreads) {
                sessionLabel.addToThreads(batch);
              }

              // Batch move to trash
              if (gmail.moveThreadsToTrash) {
                gmail.moveThreadsToTrash(batch);
              }

              totalTrashed += batch.length;
            }
          }

          // In live mode, trashed threads vanish from -in:trash query, so startIndex stays 0
          // In dry run mode, advance startIndex
          if (isDryRun) {
            startIndex += threads.length;
          }

          if (threads.length < _Config.SEARCH_CHUNK_SIZE) {
            ruleDone = true;
          }
        }
      }

      // Flush log buffer in single atomic call
      if (logBuffer.length > 0) {
        _SheetStore.flushLogBuffer(logBuffer);
      }

      return {
        success: true,
        runId: runId,
        totalMatched: totalMatched,
        totalTrashed: totalTrashed,
        watchdogTriggered: watchdogTriggered,
        durationMs: Date.now() - startTime
      };
    });
  }

  return {
    execute: execute,
    generateRunId: generateRunId,
    _mockGmail: null // Test hook
  };
})();

// Node.js test environment export support
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ExecutionEngine;
}
