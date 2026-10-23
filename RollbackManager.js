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
   * Reverses an execution run by RunID, moving all session-labeled threads from Trash back to the Inbox.
   *
   * @param {string} [specificRunId]
   * @returns {{ success: boolean, runId?: string, restoredCount?: number, message: string }}
   */
  function undoLastRun(specificRunId) {
    const _Config = getConfig();
    const _LockManager = getLockManager();
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

    return _LockManager.withLock('RollbackManager.undoLastRun', () => {
      const gmail = getGmailService();
      if (!gmail) {
        throw new Error('Gmail service is unavailable.');
      }

      const labelName = `${_Config.RUN_LABEL_PREFIX}${runId}`;
      const sessionLabel = gmail.getUserLabelByName ? gmail.getUserLabelByName(labelName) : null;

      // 1. Primary lookup: Search trash for threads tagged with this run label
      const trashQuery = `in:trash label:"${labelName}"`;
      let threads = (gmail.search ? gmail.search(trashQuery, 0, 500) : []) || [];

      // 2. Secondary defensive fallback: If session label is deleted, missing, or unindexed,
      // recover threads directly via immutable ThreadIDs recorded in the Logs sheet
      if (threads.length === 0 && _SheetStore.getThreadIdsForRun && gmail.getThreadById) {
        const loggedThreadIds = _SheetStore.getThreadIdsForRun(runId);
        if (loggedThreadIds && loggedThreadIds.length > 0) {
          const rescuedThreads = [];
          for (const tid of loggedThreadIds) {
            try {
              const thread = gmail.getThreadById(tid);
              if (thread) {
                const inTrash = (typeof thread.isInTrash === 'function') ? thread.isInTrash() : true;
                if (inTrash) {
                  rescuedThreads.push(thread);
                }
              }
            } catch (inspectErr) {
              // Thread may have been permanently deleted or is inaccessible
            }
          }
          if (rescuedThreads.length > 0) {
            threads = rescuedThreads;
          }
        }
      }

      if (threads.length === 0) {
        // Clean up empty label if it exists
        if (sessionLabel && gmail.deleteLabel) {
          try {
            gmail.deleteLabel(sessionLabel);
          } catch (e) {
            // Ignore label cleanup errors
          }
        }
        return {
          success: true,
          runId: runId,
          restoredCount: 0,
          message: 'No matching threads found in Trash for this run.'
        };
      }

      const logBuffer = [];
      let totalRestored = 0;

      // Batch restore in chunks of 50
      for (let i = 0; i < threads.length; i += _Config.BATCH_TRASH_SIZE) {
        const batch = threads.slice(i, i + _Config.BATCH_TRASH_SIZE);

        // Production Safeguard: Move threads out of trash back into inbox using the real GmailApp API
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

        // Only remove session label AFTER successful restoration to Inbox
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
            runId,
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

      // Delete the session label now that all threads are restored
      if (sessionLabel && gmail.deleteLabel) {
        try {
          gmail.deleteLabel(sessionLabel);
        } catch (e) {
          // Ignore
        }
      }

      // Flush restoration log records
      if (logBuffer.length > 0) {
        _SheetStore.flushLogBuffer(logBuffer);
      }

      return {
        success: true,
        runId: runId,
        restoredCount: totalRestored,
        message: `Successfully restored ${totalRestored} threads to Inbox.`
      };
    });
  }

  return {
    undoLastRun: undoLastRun,
    _mockGmail: null // Test hook
  };
})();

// Node.js test environment export support
if (typeof module !== 'undefined' && module.exports) {
  module.exports = RollbackManager;
}
