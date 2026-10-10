/**
 * Declutter: Production Implementation
 * File: LockManager.js
 * Description: Mutex concurrency lock using Apps Script LockService to guard against race conditions.
 */

// eslint-disable-next-line no-var
var LockManager = (function () {
  /**
   * Executes a callback function with an acquired user lock.
   * Ensures atomic execution and prevents concurrent cron/manual collisions.
   *
   * @param {string} actionName
   * @param {Function} callback
   * @returns {{ success: boolean, result?: any, error?: string, contention?: boolean }}
   */
  function withLock(actionName, callback) {
    let lock;
    const timeoutMs = (typeof Config !== 'undefined' && Config.LOCK_TIMEOUT_MS) ? Config.LOCK_TIMEOUT_MS : 10000;

    // Check if running in Google Apps Script environment
    if (typeof LockService !== 'undefined' && LockService.getUserLock) {
      lock = LockService.getUserLock();
    } else if (LockManager._mockLock) {
      lock = LockManager._mockLock;
    }

    if (lock) {
      const hasLock = lock.tryLock(timeoutMs);
      if (!hasLock) {
        const errorMsg = 'Another Declutter process is currently running. Please try again shortly.';
        if (typeof Logger !== 'undefined') {
          Logger.log(`[LockManager] Lock contention for ${actionName}: ${errorMsg}`);
        }
        return {
          success: false,
          error: errorMsg,
          contention: true
        };
      }
    }

    try {
      const result = callback();
      return {
        success: true,
        result: result
      };
    } catch (err) {
      const errorMsg = err && err.message ? err.message : String(err);
      if (typeof Logger !== 'undefined') {
        Logger.log(`[LockManager] Error during ${actionName}: ${errorMsg}`);
      }
      return {
        success: false,
        error: errorMsg
      };
    } finally {
      if (lock) {
        try {
          lock.releaseLock();
        } catch (releaseErr) {
          // Ignore release errors if lock expired
        }
      }
    }
  }

  return {
    withLock: withLock,
    _mockLock: null // Test hook
  };
})();

// Node.js test environment export support
if (typeof module !== 'undefined' && module.exports) {
  module.exports = LockManager;
}
