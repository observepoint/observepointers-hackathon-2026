// The message bus contract. Both the service worker and the content script import
// from here so there is exactly one definition of every type and payload shape.
//
// Every message on the wire is { type, payload }. Anything belonging to a running
// walkthrough carries `sessionId` so late-arriving messages from an ended session
// can be dropped instead of advancing a fresh one.
//
// Ownership note: the step-level types (EXECUTE_STEP, STEP_COMPLETED, STEP_FAILED) belong
// to the page layer — content/page-layer.js, owned by Person 3. They're declared here
// because the catalog is shared, and the service worker already routes and logs them,
// which is useful for debugging a step that won't advance.

export const MSG = {
  // Chat UI -> background. Triggers generation. Responds { plan } or { error }.
  INTENT_RECEIVED: 'INTENT_RECEIVED',
  // Content script -> background. Simplified DOM snapshot for ad-hoc generation.
  PAGE_CONTEXT_UPDATED: 'PAGE_CONTEXT_UPDATED',
  // Page layer. Highlight an element or perform an AI action.
  EXECUTE_STEP: 'EXECUTE_STEP',
  // Page layer. A step finished; move to the next one.
  STEP_COMPLETED: 'STEP_COMPLETED',
  // Page layer. Element never resolved, or the action threw.
  STEP_FAILED: 'STEP_FAILED',

  GET_PROFILE: 'GET_PROFILE',
  SAVE_PROFILE: 'SAVE_PROFILE',
  RESET_PROFILE: 'RESET_PROFILE',

  LIST_RECIPES: 'LIST_RECIPES',
  START_WALKTHROUGH: 'START_WALKTHROUGH',
  END_WALKTHROUGH: 'END_WALKTHROUGH',
  RUNNER_STATE_CHANGED: 'RUNNER_STATE_CHANGED',

  // Background -> content script. Backup url_change signal from tabs.onUpdated,
  // for the case where our in-page history patch missed a navigation.
  URL_CHANGED: 'URL_CHANGED',
  // Background -> content script. Toolbar icon clicked; open the picker.
  OPEN_PICKER: 'OPEN_PICKER',
}

/** Reasons a walkthrough can end. Recorded so we can tell abandonment from success. */
export const END_REASON = {
  USER: 'user',
  COMPLETE: 'complete',
  ERROR: 'error',
}

/** Build a message envelope. */
export function msg(type, payload = {}) {
  return { type, payload }
}

/**
 * Send to the service worker and resolve with its response.
 *
 * Swallows the "Receiving end does not exist" / "message port closed" rejections
 * that MV3 produces routinely when the worker is asleep or a listener chose not
 * to respond. Callers get null and carry on rather than seeing an unhandled
 * rejection in the page console.
 */
export async function sendToBackground(type, payload = {}) {
  try {
    return await chrome.runtime.sendMessage(msg(type, payload))
  } catch (error) {
    console.debug('[op-walkthroughs] background unreachable', type, error?.message)
    return null
  }
}

/** Send to the content script in a specific tab. Same tolerance as above. */
export async function sendToTab(tabId, type, payload = {}) {
  try {
    return await chrome.tabs.sendMessage(tabId, msg(type, payload))
  } catch (error) {
    console.debug('[op-walkthroughs] tab unreachable', tabId, type, error?.message)
    return null
  }
}
