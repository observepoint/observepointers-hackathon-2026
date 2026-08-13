// Service worker: thin, stateless message router.
//
// Nothing that has to survive is kept here. MV3 terminates this worker after ~30s idle,
// and a walkthrough spends most of its life waiting on a human to read something and
// click — so any state held in this context would simply evaporate mid-tour. Walkthrough
// state belongs to the page layer, persisted to chrome.storage.local.
//
// What genuinely belongs here:
//   - plan generation (the one context that should hold an API key)
//   - the toolbar action
//   - tabs.onUpdated, relayed as a backup url_change signal
//   - a central place to log step traffic when a walkthrough won't advance

import { MSG, sendToTab } from '../shared/messages.js'
import { storage, KEYS } from '../shared/utils.js'
import { recipeSummaries } from '../shared/recipes.js'
import { generatePlan } from './generate-plan.js'

console.log('[op-walkthroughs] service worker started')

// Clicking the toolbar icon opens the picker in place, rather than a popup — there is
// no second UI to maintain, and the walkthrough UI lives in the page anyway.
chrome.action.onClicked.addListener(tab => {
  if (tab.id) sendToTab(tab.id, MSG.OPEN_PICKER)
})

// Backup route-change signal. This does fire with changeInfo.url for History API
// navigations, but it round-trips through a worker that may be asleep, so the content
// script's own history patch is primary. Host permissions cover the url field here,
// which is why the manifest needs no "tabs" permission.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) sendToTab(tabId, MSG.URL_CHANGED, { url: changeInfo.url })
})

/**
 * Handle one message. Split out so the listener can stay synchronous about its
 * return value (see the `return true` note below).
 */
async function handle(type, payload) {
  switch (type) {
    case MSG.INTENT_RECEIVED:
      return generatePlan(payload?.intent ?? '', payload?.pageContext)

    case MSG.LIST_RECIPES:
      return { recipes: recipeSummaries() }

    case MSG.GET_PROFILE:
      return { profile: await storage.sync.get(KEYS.PROFILE) }

    case MSG.SAVE_PROFILE:
      await storage.sync.set(KEYS.PROFILE, payload?.profile)
      return { ok: true }

    case MSG.RESET_PROFILE:
      await Promise.all([
        storage.sync.remove(KEYS.PROFILE),
        storage.local.remove(KEYS.PROGRESS),
        storage.local.remove(KEYS.SESSION),
      ])
      return { ok: true }

    // The page layer owns the walkthrough, so these are observability only. Useful in
    // the worker console when a step isn't advancing.
    case MSG.PAGE_CONTEXT_UPDATED:
      console.debug('[op-walkthroughs] page context', payload?.url, payload?.elements?.length)
      return { ok: true }

    case MSG.STEP_COMPLETED:
      console.debug('[op-walkthroughs] step completed', payload?.stepIndex, 'via', payload?.via)
      return { ok: true }

    case MSG.STEP_FAILED:
      console.warn('[op-walkthroughs] step failed', payload?.stepIndex, payload?.reason)
      return { ok: true }

    case MSG.RUNNER_STATE_CHANGED:
      console.debug('[op-walkthroughs] walkthrough', payload?.status, payload?.recipeId)
      return { ok: true }

    default:
      return { ok: false, error: `unhandled message type: ${type}` }
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const { type, payload } = message ?? {}

  handle(type, payload)
    .then(sendResponse)
    .catch(error => {
      console.error('[op-walkthroughs] handler threw', type, error)
      sendResponse({ ok: false, error: error.message })
    })

  // Keeps the message channel open for the async response above. Without it, Chrome
  // closes the port the moment this listener returns and sendResponse is a no-op.
  return true
})
