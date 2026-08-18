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
//   - the toolbar action
//   - tabs.onUpdated, relayed as a backup url_change signal
//   - a central place to log step traffic when a walkthrough won't advance
//   - the authenticated API reads, for the reason below
//
// WHY THE ACCOUNT FETCH LIVES HERE
// The first attempt made the call from the content script, on the app's own origin.
// Every /api/* path came back 200 text/html, which means that host serves the SPA for
// anything it doesn't recognize -- the API is on a different host. A content script's
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
// Part 1's planner. It used to be imported by the side panel; the launcher that replaced
// the panel lives in a content script, and a content script is the wrong place for this --
// it would put the model prompt, and on the API-key path the key itself, on the app's
// origin. Planning was already listed above as belonging here.
import { createPlan, answerAndRetry } from '../planner/index.js'
// The row -> object mappers, NOT the list functions: those reach the API through this
// worker over chrome.runtime.sendMessage, and a sender does not receive its own message.
// Importing the mappers means there is one mapping rather than two — the duplicate cost
// an outage, see the note above rowsOf in account.js.
import { API, rowsOf, toConsentCategory, toRule, toAlert } from '../planner/account.js'

console.log('[observe-pointers] service worker started')

// Part 1's panel sends these; they are answered by the content script, not here.
const FORWARD_TO_TAB = new Set(['PLAN_READY', 'OP_ACCOUNT_STATUS', 'OP_CHECK_SELECTORS'])

// The toolbar brings the launcher forward. There is no side panel to open any more --
// the chat is a circle in the corner of the app itself, so the toolbar icon is a way back
// to it rather than a second place to look.
chrome.action.onClicked.addListener(tab => {
  if (tab.id) sendToTab(tab.id, 'OP_TOGGLE_BUBBLE')
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
 * Whatever we can read about the live account, for the state-aware recipes.
 *
 * Best effort on purpose. Every recipe treats a missing list as "could not see the
 * account" rather than "the account is empty", so a failed read costs a specific
 * suggestion and nothing else. Blocking a plan on it would be the wrong trade.
 */
async function readAccount() {
  // apiGet/apiPost directly, with account.js's own mappers on top. Every field those
  // produce is load-bearing: rankForSite reads `labels`, and bestCategoryFor chooses
  // between 79 otherwise identical consent categories on `cmpDomain`, `cmpGeo` and
  // `auditCount`. A hand-written copy of the mapping here omitted `labels` and every
  // plan came back as "Cannot read properties of undefined (reading 'join')".
  const [ccReply, ruleReply, alertReply] = await Promise.all([
    apiGet(API.consentCategories).catch(() => ({ ok: false })),
    apiGet(API.rules).catch(() => ({ ok: false })),
    apiPost(API.alerts, {}).catch(() => ({ ok: false })),
  ])

  // undefined, not [], when a read fails: every recipe treats a missing list as "could
  // not see the account" rather than "the account is empty", and telling someone with a
  // full library to go build a duplicate is the worse error.
  const consentCategories = ccReply.ok
    ? rowsOf(ccReply.data, 'consentCategories', 'items', 'data').map(toConsentCategory)
    : undefined
  const rules = ruleReply.ok
    ? rowsOf(ruleReply.data, 'rules', 'items', 'data').map(toRule)
    : undefined
  const alerts = alertReply.ok
    ? rowsOf(alertReply.data, 'alerts', 'items', 'data').map(toAlert)
    : undefined

  if (!consentCategories && !rules && !alerts) return null
  return { consentCategories, rules, alerts }
}

/**
 * Handle one message. Split out so the listener can stay synchronous about its
 * return value (see the `return true` note below).
 */
async function handle(type, payload, message) {
  switch (type) {
    case MSG.INTENT_RECEIVED:
      return generatePlan(payload?.intent ?? '', payload?.pageContext)

    // Part 1's planning, from the launcher. The content script sends a goal and gets
    // back the same discriminated union createPlan() has always returned; when it is a
    // plan, PLAN_READY goes to the tab from here, exactly as the side panel used to send
    // it. So the handoff to Part 2 is unchanged.
    case 'OP_PLAN': {
      // PLANNING AND DELIVERY ARE SEPARATE, and the try/catch boundaries say so.
      //
      // The listener below turns any throw into { ok: false, error } — no `status` — so a
      // failure anywhere in here used to surface as the launcher's catch-all line with
      // the actual reason discarded. Two things follow: the reason always travels, and a
      // plan that was built successfully is never lost to a problem delivering it.
      let result
      try {
        const account = await readAccount()
        result = payload?.pending
          ? answerAndRetry(payload.pending, payload.answer ?? '', payload.goal ?? '', { account })
          : await createPlan(payload?.goal ?? '', { account })
      } catch (error) {
        console.error('[observe-pointers] planning failed', error)
        return { status: 'error', message: `Planning failed: ${error?.message ?? error}` }
      }

      // `recipe` carries functions (buildSteps, derive) and cannot cross the message
      // boundary; nothing on the other side wants it.
      const reply = Object.fromEntries(Object.entries(result).filter(([key]) => key !== 'recipe'))

      if (result.status !== 'plan') return reply

      try {
        const tab = await activeTab()
        await ensureContentScript(tab.id)
        // Flat, not via sendToTab: PLAN_READY is Part 1's shape and the content script
        // reads message.plan / message.plans directly. sendToTab wraps into
        // { type, payload }, which would arrive as an empty PLAN_READY.
        await chrome.tabs.sendMessage(tab.id, {
          type: 'PLAN_READY',
          plan: result.plan,
          plans: result.plans,
        })
      } catch (error) {
        console.error('[observe-pointers] could not start the walkthrough', error)
        // The plan is good; only the handoff failed. Say which, because "something went
        // wrong" sends someone looking at the planner for a messaging problem.
        reply.startError = `Planned it, but could not start the walkthrough: ${error?.message ?? error}`
      }

      return reply
    }

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
