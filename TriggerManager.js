/**
 * Declutter: Production Implementation
 * File: TriggerManager.js
 * Description: Programmatic manager for daily scheduled Apps Script clock triggers.
 */

// eslint-disable-next-line no-var
var TriggerManager = (function () {
  const HANDLER_FUNCTION = 'runDeclutterAutomated';

  /**
   * Sets up or resets the daily 2:00 AM clock trigger.
   * Removes any preexisting duplicate triggers for the handler.
   *
   * @returns {{ success: boolean, message: string, triggerId?: string }}
   */
  function setupDailyAutomation() {
    if (typeof ScriptApp === 'undefined') {
      return {
        success: false,
        message: 'ScriptApp is unavailable in this environment.'
      };
    }

    try {
      // 1. Clear any existing triggers for this handler to prevent duplication
      const existingTriggers = ScriptApp.getProjectTriggers();
      for (const trigger of existingTriggers) {
        if (trigger.getHandlerFunction() === HANDLER_FUNCTION) {
          ScriptApp.deleteTrigger(trigger);
        }
      }

      // 2. Register fresh daily 2:00 AM clock trigger
      const newTrigger = ScriptApp.newTrigger(HANDLER_FUNCTION)
        .timeBased()
        .everyDays(1)
        .atHour(2)
        .create();

      return {
        success: true,
        message: 'Automated daily cleanup scheduled successfully for 2:00 AM.',
        triggerId: newTrigger.getUniqueId ? newTrigger.getUniqueId() : 'registered'
      };
    } catch (err) {
      const errorMsg = err && err.message ? err.message : String(err);
      return {
        success: false,
        message: `Failed to schedule daily trigger: ${errorMsg}`
      };
    }
  }

  return {
    setupDailyAutomation: setupDailyAutomation,
    HANDLER_FUNCTION: HANDLER_FUNCTION
  };
})();

// Node.js test environment export support
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TriggerManager;
}
