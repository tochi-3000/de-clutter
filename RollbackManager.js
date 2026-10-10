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
      const sessionLabel = gmail.getUserLabelByName(labelName);

      // Search trash for threads tagged with this run label
      const trashQuery = `in:trash label:"${labelName}"`;
      const threads = gmail.search(trashQuery, 0, 500) || [];

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

        // Move threads out of trash back into inbox
        if (gmail.moveThreadsFromTrash) {
          gmail.moveThreadsFromTrash(batch);
        }

        // Remove the session label
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
