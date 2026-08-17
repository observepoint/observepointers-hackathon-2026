// Service worker: message router, and the one place that talks to an API.
//
// MERGED. Part 2's router and plan pipeline, plus Part 1's account bridge. The two
// halves share no message types -- Part 2's are MSG.*, Part 1's are OP_* plus
// PLAN_READY -- so this file is a concatenation rather than a compromise.
//
// Nothing that has to survive is kept here. MV3 terminates this worker after ~30s idle,
// and a walkthrough spends most of its life waiting on a human to read something and
// click -- so any state held in this context would simply evaporate mid-tour. Walkthrough
// state belongs to the page layer, persisted to chrome.storage.local.
//
// What genuinely belongs here:
//   - plan generation (the one context that should hold an API key)
//   - the toolbar action and the side panel behaviour
//   - tabs.onUpdated, relayed as a backup url_change signal
//   - a central place to log step traffic when a walkthrough won't advance
//   - the authenticated API reads, for the reason below
//
// WHY THE ACCOUNT FETCH LIVES HERE
// The first attempt made the call from the content script, on the app's own origin.
// Every /api/* path came back 200 text/html, which means that host serves the SPA for
// anything it doesn't recognise -- the API is on a different host. A content script's
// cross-origin fetch obeys the *page's* CORS policy; the service worker's obeys the
// extension's host_permissions, which is why the call has to happen here.
//
//   panel --OP_API_GET--> background --OP_AUTH_CONTEXT--> content script
//                              |                            (reads token)
//                              +---- fetch(apiBase + path) ---> API
//
// The token goes content script -> background and no further. The panel only ever
// receives JSON.

import { MSG, sendToTab } from '../shared/messages.js'
import { storage, KEYS } from '../shared/utils.js'
import { recipeSummaries } from '../shared/recipes.js'
import { generatePlan } from './generate-plan.js'

console.log('[observe-pointers] service worker started')

// Part 1's panel sends these; they are answered by the content script, not here.
const FORWARD_TO_TAB = new Set(['PLAN_READY', 'OP_ACCOUNT_STATUS', 'OP_CHECK_SELECTORS'])

// The toolbar opens the side panel, because that is where the chat and voice input
// live and voice needs the extension origin.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error)
})

// Part 2's picker was reached from the toolbar. It no longer can be: while
// openPanelOnActionClick is true Chrome opens the panel and this listener never
// fires. Kept, not deleted, because it becomes live again the moment that flag is
// flipped -- and because the picker already has a better entry point than a toolbar
// icon, the "Walkthroughs" item Part 2 added to the app's own Settings menu.
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
 *
 * This is also the escape hatch for the narrowed content_scripts.matches. The
 * manifest only auto-injects on ObservePoint hosts, but executeScript is gated
 * by host permissions / activeTab rather than by those matches — so if Part 2 or
 * Part 3 needs the pointer on some other page to test, this path still reaches
 * it once the panel has been opened.
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

async function fetchJson(base, path, token, init = {}) {
  const url = new URL(path, base).toString()

  try {
    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
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

/**
 * The only paths a POST may reach.
 *
 * Deliberately an allowlist, not a general proxy. A GET-only bridge bounds the worst
 * case to reading the account; the moment the panel can POST arbitrary paths with
 * the user's bearer token, a bug up there can write to it. The alerts library
 * happens to be a SEARCH implemented as a POST (filters in the body, paging in the
 * query), which is the only reason POST is here at all.
 *
 * Add to this list only for reads. Anything that creates or changes an object stays
 * with the user's own click — that is the standing rule for this whole extension,
 * and it should hold at the transport layer too, not just in the recipes.
 */
const POST_ALLOWLIST = new Set(['/api/v3/alerts/library'])

async function apiPost(path, body) {
  const bare = String(path ?? '').split('?')[0]
  if (!POST_ALLOWLIST.has(bare)) {
    return { ok: false, error: `post-not-allowed: ${bare}` }
  }
  return apiRequest(path, { method: 'POST', body: JSON.stringify(body ?? {}) })
}

async function apiGet(path) {
  return apiRequest(path)
}

async function apiRequest(path, init = {}) {
  const tab = await activeTab()
  await ensureContentScript(tab.id)

  const auth = await chrome.tabs.sendMessage(tab.id, { type: 'OP_AUTH_CONTEXT' })
  if (!auth?.ok) return { ok: false, error: auth?.error || 'no-auth-context' }

  const attempts = []
  for (const base of apiBasesFor(auth.origin, auth.hostname)) {
    const result = await fetchJson(base, path, auth.token, init)
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

/**
 * Handle one message. Split out so the listener can stay synchronous about its
 * return value (see the `return true` note below).
 */
async function handle(type, payload, message) {
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

    // --- Part 1 ----------------------------------------------------------
    // Flat messages, so these read off `message` rather than `payload`.
    case 'OP_API_GET':
      return apiGet(message?.path)

    // Only for reads that happen to be implemented as POSTs. See POST_ALLOWLIST.
    case 'OP_API_POST':
      return apiPost(message?.path, message?.body)

    default:
      if (FORWARD_TO_TAB.has(type)) {
        const tab = await activeTab()
        await ensureContentScript(tab.id)
        return chrome.tabs.sendMessage(tab.id, message)
      }
      return { ok: false, error: `unhandled message type: ${type}` }
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const { type, payload } = message ?? {}

  handle(type, payload, message)
    .then(sendResponse)
    .catch(error => {
      console.error('[observe-pointers] handler threw', type, error)
      sendResponse({ ok: false, error: error.message })
    })

  // Keeps the message channel open for the async response above. Without it, Chrome
  // closes the port the moment this listener returns and sendResponse is a no-op.
  return true
})
