/**
 * Background service worker — the router.
 *
 * The side panel can't message a tab directly, so everything between it and the
 * page hops through here:
 *
 *   PLAN_READY          panel → page   (Part 2 picks it up)
 *   OP_API_GET          panel → page   (account reads, see content/index.js)
 *   OP_ACCOUNT_STATUS   panel → page   ("can I read the account right now?")
 */

const TO_ACTIVE_TAB = new Set(['PLAN_READY', 'OP_API_GET', 'OP_ACCOUNT_STATUS'])

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error)
})

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  if (!tab?.id) throw new Error('No active tab.')
  if (/^(chrome|edge|about|chrome-extension):/.test(tab.url || '')) {
    throw new Error('Browser-internal page — switch to the ObservePoint tab.')
  }
  return tab
}

/**
 * Tabs open before the extension loaded have no content script. Ping, and
 * inject on failure, so nobody has to be told to reload the page.
 *
 * The file path has to come from the runtime manifest, not from source: the
 * build renames content scripts (`assets/index.js-<hash>.js`), so a hardcoded
 * `src/content/index.js` works in dev and silently 404s in a built extension.
 */
async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'OP_ACCOUNT_STATUS' })
    return
  } catch {
    /* not there yet — inject below */
  }

  const files = chrome.runtime.getManifest().content_scripts?.[0]?.js ?? []
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files })
  } catch (error) {
    // Bundled content scripts are ES modules and can refuse programmatic
    // injection. Reloading the tab is the reliable fix, so say that plainly
    // rather than failing with a module-resolution error.
    throw new Error(`Reload the ObservePoint tab so the Copilot can attach. (${error.message})`, {
      cause: error,
    })
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!TO_ACTIVE_TAB.has(message?.type)) return false
  ;(async () => {
    try {
      const tab = await activeTab()
      await ensureContentScript(tab.id)
      sendResponse(await chrome.tabs.sendMessage(tab.id, message))
    } catch (error) {
      sendResponse({ ok: false, error: error.message })
    }
  })()

  return true // async response
})
