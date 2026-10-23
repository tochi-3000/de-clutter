/**
 * Declutter: Production Implementation
 * File: RollbackManager.js
 * Description: 1-Click disaster recovery engine to safely restore trashed threads from session run labels.
 */

// eslint-disable-next-line no-var
var RollbackManager = (function () {
  function getConfig() {
    return (typeof Config !== 'undefined') ? Config : (typeof require !== 'undefined' ? require('./Config.js') : {});
  }
  function getLockManager() {
    return (typeof LockManager !== 'undefined') ? LockManager : (typeof require !== 'undefined' ? require('./LockManager.js') : {});
  }
  function getSheetStore() {
    return (typeof SheetStore !== 'undefined') ? SheetStore : (typeof require !== 'undefined' ? require('./SheetStore.js') : {});
  }

  /**
   * Safe wrapper for GmailApp.
   */
  function getGmailService() {
    if (typeof GmailApp !== 'undefined') {
      return GmailApp;
    }
    return RollbackManager._mockGmail || null;
  }

  /**
   * Restores specific threads from Trash back to the Inbox.
   * Manages partial session label retention and records granular audit logs.
   *
   * @param {string[]} threadIds
   * @param {string} [specificRunId]
   * @returns {{ success: boolean, result?: { runId?: string, restoredCount: number, message: string }, message?: string, error?: string }}
   */
  function restoreSpecificThreads(threadIds, specificRunId) {
    if (!threadIds || !Array.isArray(threadIds) || threadIds.length === 0) {
      return {
        success: false,
        message: 'No thread IDs provided for restoration.'
      };
    }

    const _Config = getConfig();
    const _LockManager = getLockManager();
    const _SheetStore = getSheetStore();

    let runId = specificRunId;
    if (!runId) {
      const latest = _SheetStore.getLatestRunMetadata();
      runId = latest ? latest.runId : null;
    }

    return _LockManager.withLock('RollbackManager.restoreSpecificThreads', () => {
      const gmail = getGmailService();
      if (!gmail) {
        throw new Error('Gmail service is unavailable.');
      }

      // Sanitize and deduplicate thread IDs
      const uniqueIds = Array.from(new Set(threadIds.map(id => String(id).trim()).filter(Boolean)));
      if (uniqueIds.length === 0) {
        return {
          runId: runId,
          restoredCount: 0,
          message: 'No valid thread IDs provided.'
        };
      }

      // Fetch threads and filter for those currently in Trash
      const threadsToRestore = [];
      for (const id of uniqueIds) {
        try {
          const thread = gmail.getThreadById ? gmail.getThreadById(id) : null;
          if (thread) {
            const inTrash = (typeof thread.isInTrash === 'function') ? thread.isInTrash() : true;
            if (inTrash) {
              threadsToRestore.push(thread);
            }
          }
        } catch (err) {
          // Ignore threads that cannot be retrieved or permanently deleted
        }
      }

      if (threadsToRestore.length === 0) {
        return {
          runId: runId,
          restoredCount: 0,
          message: 'None of the selected threads are currently in Trash.'
        };
      }

      const labelName = runId ? `${_Config.RUN_LABEL_PREFIX}${runId}` : null;
      const sessionLabel = (labelName && gmail.getUserLabelByName) ? gmail.getUserLabelByName(labelName) : null;

      const logBuffer = [];
      let totalRestored = 0;

      // Batch restore in chunks of 50
      for (let i = 0; i < threadsToRestore.length; i += _Config.BATCH_TRASH_SIZE) {
        const batch = threadsToRestore.slice(i, i + _Config.BATCH_TRASH_SIZE);

        // Production Safeguard: Restore threads to Inbox via real GmailApp API
        try {
          if (gmail.moveThreadsToInbox) {
            gmail.moveThreadsToInbox(batch);
          } else {
            let movedAny = false;
            for (const thread of batch) {
              if (thread && thread.moveToInbox) {
                thread.moveToInbox();
                movedAny = true;
              }
            }
            if (!movedAny && batch.length > 0) {
              throw new Error('Gmail service does not support moveThreadsToInbox or thread.moveToInbox.');
            }
          }
        } catch (moveErr) {
          if (typeof Logger !== 'undefined') {
            Logger.log(`[RollbackManager] Failed to restore thread batch: ${moveErr.message || moveErr}`);
          }
          throw new Error(`Failed to restore threads to Inbox: ${moveErr.message || moveErr}`);
        }

        // Production Safeguard: Strip session label ONLY from the restored threads
        if (sessionLabel && sessionLabel.removeFromThreads) {
          try {
            sessionLabel.removeFromThreads(batch);
          } catch (e) {
            // Ignore thread unlabel errors
          }
        }

        // Record restore log entries
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
          } catch (e) {
            // Ignore message inspection errors
          }

          logBuffer.push([
            new Date().toISOString(),
            runId || 'MANUAL-RESTORE',
            'ROLLBACK',
            sender,
            subject,
            receivedDate,
            thread.getId ? thread.getId() : '',
            _Config.EXEC_MODE.LIVE,
            _Config.LOG_ACTION.RESTORED
          ]);
        }

        totalRestored += batch.length;
      }

      // Production Safeguard: Session label lifecycle check
      // Only delete the session label if NO remaining threads exist in Trash with this label
      if (sessionLabel && gmail.search && gmail.deleteLabel) {
        try {
          const remainingTrashed = gmail.search(`in:trash label:"${labelName}"`, 0, 1) || [];
          if (remainingTrashed.length === 0) {
            gmail.deleteLabel(sessionLabel);
          }
        } catch (e) {
          // Ignore label cleanup errors
        }
      }

      // Flush restoration log records atomically
      if (logBuffer.length > 0) {
        _SheetStore.flushLogBuffer(logBuffer);
      }

      return {
        runId: runId,
        restoredCount: totalRestored,
        message: `Successfully restored ${totalRestored} thread(s) to Inbox.`
      };
    });
  }

  /**
   * Reverses an execution run by RunID, moving all session-labeled threads from Trash back to the Inbox.
   *
   * @param {string} [specificRunId]
   * @returns {{ success: boolean, result?: { runId?: string, restoredCount: number, message: string }, message?: string, error?: string }}
   */
  function undoLastRun(specificRunId) {
    const _Config = getConfig();
    const _SheetStore = getSheetStore();

    let runId = specificRunId;

    // If RunID is not explicitly provided, fetch the most recent run from Logs
    if (!runId) {
      const latest = _SheetStore.getLatestRunMetadata();
      runId = latest ? latest.runId : null;
    }

    if (!runId) {
      return {
        success: false,
        message: 'No existing run'
      };
    }

    const gmail = getGmailService();
    if (!gmail) {
      throw new Error('Gmail service is unavailable.');
    }

    const labelName = `${_Config.RUN_LABEL_PREFIX}${runId}`;
    const sessionLabel = gmail.getUserLabelByName ? gmail.getUserLabelByName(labelName) : null;

    // 1. Primary lookup: Search trash for threads tagged with this run label
    let candidateIds = [];
    if (sessionLabel && gmail.search) {
      const trashQuery = `in:trash label:"${labelName}"`;
      const threads = gmail.search(trashQuery, 0, 500) || [];
      candidateIds = threads.map(t => (t.getId ? t.getId() : t.id));
    }

    // 2. Secondary defensive fallback: Recover threads directly via immutable ThreadIDs recorded in Logs
    if (candidateIds.length === 0 && _SheetStore.getThreadIdsForRun) {
      candidateIds = _SheetStore.getThreadIdsForRun(runId);
    }

    if (!candidateIds || candidateIds.length === 0) {
      if (sessionLabel && gmail.deleteLabel) {
        try {
          gmail.deleteLabel(sessionLabel);
        } catch (e) {
          // Ignore
        }
      }
      return {
        success: true,
        result: {
          runId: runId,
          restoredCount: 0,
          message: 'No matching threads found in Trash for this run.'
        }
      };
    }

    return restoreSpecificThreads(candidateIds, runId);
  }

  return {
    undoLastRun: undoLastRun,
    restoreSpecificThreads: restoreSpecificThreads,
    _mockGmail: null // Test hook
  };
})();

// Node.js test environment export support
if (typeof module !== 'undefined' && module.exports) {
  module.exports = RollbackManager;
}
