/**
 * Background service worker — router, and the one place that talks to the API.
 *
 * WHY THE FETCH LIVES HERE
 * The first attempt made the call from the content script, on the app's own
 * origin. Every /api/* path came back 200 text/html, which means that host
 * serves the SPA for anything it doesn't recognise — the API is on a different
 * host. A content script's cross-origin fetch obeys the *page's* CORS policy;
 * the service worker's obeys the extension's host_permissions, which is why the
 * call has to happen here.
 *
 *   panel ──OP_API_GET──▶ background ──OP_AUTH_CONTEXT──▶ content script
 *                              │                              (reads token)
 *                              └──── fetch(apiBase + path) ───▶ API
 *
 * The token goes content script → background and no further. The panel only
 * ever receives JSON.
 */

const FORWARD_TO_TAB = new Set(['PLAN_READY', 'OP_ACCOUNT_STATUS', 'OP_CHECK_SELECTORS'])

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
 * inject on failure. The file path must come from the runtime manifest: the
 * build renames content scripts, so a hardcoded src/ path 404s once built.
 */
async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'OP_ACCOUNT_STATUS' })
    return
  } catch {
    /* not attached yet */
  }

  const files = chrome.runtime.getManifest().content_scripts?.[0]?.js ?? []
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files })
  } catch (error) {
    throw new Error(`Reload the ObservePoint tab so the Copilot can attach. (${error.message})`, {
      cause: error,
    })
  }
}

/**
 * Hosts to try, in order. The tab's own origin first — if it ever does proxy
 * /api, that is the correct answer and needs no special case. Then the canonical
 * app host for the same environment, which is what moonbeam's environment.*.ts
 * files point at.
 */
function apiBasesFor(origin, hostname) {
  // A locally-served moonbeam has no local API. Its dev environment.ts points
  // apiUrl at app.observepointstaging.com, so that is where account reads go —
  // don't waste a round trip on localhost first.
  if (/^(localhost|127\.0\.0\.1)$/i.test(hostname)) {
    return ['https://app.observepointstaging.com']
  }

  const canonical = hostname.includes('observepointstaging')
    ? 'https://app.observepointstaging.com'
    : 'https://app.observepoint.com'

  return canonical === origin ? [origin] : [origin, canonical]
}

async function fetchJson(base, path, token) {
  const url = new URL(path, base).toString()

  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      credentials: 'include',
    })

    const contentType = response.headers.get('content-type') ?? ''
    const body = await response.text()

    if (!response.ok) {
      return {
        ok: false,
        base,
        status: response.status,
        contentType,
        error: `http-${response.status}`,
        snippet: body.slice(0, 160),
      }
    }
    // 200 + HTML means we hit an SPA catch-all, not the API.
    if (!contentType.includes('json')) {
      return {
        ok: false,
        base,
        status: response.status,
        contentType,
        error: 'not-json',
        snippet: body.slice(0, 160),
      }
    }

    try {
      return { ok: true, base, data: JSON.parse(body) }
    } catch {
      return { ok: false, base, status: response.status, contentType, error: 'bad-json' }
    }
  } catch (error) {
    return { ok: false, base, error: error.message }
  }
}

async function apiGet(path) {
  const tab = await activeTab()
  await ensureContentScript(tab.id)

  const auth = await chrome.tabs.sendMessage(tab.id, { type: 'OP_AUTH_CONTEXT' })
  if (!auth?.ok) return { ok: false, error: auth?.error || 'no-auth-context' }

  const attempts = []
  for (const base of apiBasesFor(auth.origin, auth.hostname)) {
    const result = await fetchJson(base, path, auth.token)
    attempts.push(result)
    if (result.ok) return { ok: true, data: result.data, base, environment: auth.environment }
  }

  // Every base failed — hand all of them back, since which ones failed and how
  // is the whole diagnosis.
  const last = attempts.at(-1) ?? {}
  return {
    ok: false,
    error: last.error || 'unreachable',
    status: last.status,
    contentType: last.contentType,
    attempts,
    hostname: auth.hostname,
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'OP_API_GET') {
    apiGet(message.path)
      .then(sendResponse)
      .catch(error => sendResponse({ ok: false, error: error.message }))
    return true
  }

  if (!FORWARD_TO_TAB.has(message?.type)) return false
  ;(async () => {
    try {
      const tab = await activeTab()
      await ensureContentScript(tab.id)
      sendResponse(await chrome.tabs.sendMessage(tab.id, message))
    } catch (error) {
      sendResponse({ ok: false, error: error.message })
    }
  })()

  return true
})
