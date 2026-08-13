/**
 * Background service worker.
 *
 * Part 1 keeps this thin on purpose — the side panel does the planning, and
 * Part 2 will own the walkthrough runtime. Two jobs here:
 *   1. Open the side panel when the toolbar icon is clicked.
 *   2. Relay PLAN_READY from the panel to the active tab, so Part 2's content
 *      script can pick it up without the panel needing tab plumbing.
 */

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error)
})

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'PLAN_READY') return false

  console.log(
    '[copilot] plan ready:',
    message.plan?.recipeId,
    `${message.plan?.steps?.length} steps`,
  )

  // Forward to the page for Part 2. Nothing may be listening yet while they
  // build; that is not an error worth surfacing in the chat.
  ;(async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
      if (tab?.id) {
        await chrome.tabs.sendMessage(tab.id, message).catch(() => {})
      }
      sendResponse({ ok: true })
    } catch (error) {
      sendResponse({ ok: false, error: error.message })
    }
  })()

  return true // async response
})
