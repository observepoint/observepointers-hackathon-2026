/**
 * Part 1 — the chat surface.
 *
 * Takes a question (typed or spoken), runs it through the planner, renders the
 * result, and hands the finished Plan to Part 2.
 *
 * THE HANDOFF (Part 2 listens for this):
 *   chrome.runtime.sendMessage({ type: 'PLAN_READY', plan })
 *
 * That's the entire integration surface. Part 2 does not import from Part 1 and
 * does not need to know a model was involved.
 */

import { mountInput } from './input.js'
// DEBUG — delete this import and the renderOutgoingPlan() call below to remove.
import { renderOutgoingPlan } from './debug-plan.js'
import { createPlan, answerAndRetry, suggestions } from '../planner/index.js'
import { hostFrom } from '../planner/naming.js'
import { getStoredApiKey } from '../planner/llm.js'
import { status as accountStatus, listConsentCategories, rankForSite } from '../planner/account.js'

const transcript = document.getElementById('transcript')
const statusEl = document.getElementById('status')

let controller = null
let pendingQuestion = null // a `needs_input` result awaiting an answer
let lastCategories = [] // account state, for the state-aware flow being built on this
let lastGoal = ''

/* ---------------------------------------------------------------------- *
 * Rendering
 * ---------------------------------------------------------------------- */

function addMessage(role, text) {
  const el = document.createElement('div')
  el.className = `msg ${role}`
  el.textContent = text
  transcript.appendChild(el)
  transcript.scrollTop = transcript.scrollHeight
  return el
}

function addSuggestions(items) {
  const wrap = document.createElement('div')
  wrap.className = 'chips'
  for (const item of items) {
    const chip = document.createElement('button')
    chip.className = 'chip'
    chip.textContent = item.title
    chip.title = item.example
    chip.addEventListener('click', () => controller.prefill(item.example))
    wrap.appendChild(chip)
  }
  transcript.appendChild(wrap)
  transcript.scrollTop = transcript.scrollHeight
}

function renderPlan(result) {
  const { plan, warnings } = result

  const card = document.createElement('div')
  card.className = 'plan'

  const title = document.createElement('h2')
  title.textContent = plan.summary
  card.appendChild(title)

  const list = document.createElement('ol')
  for (const step of plan.steps) {
    const li = document.createElement('li')
    li.textContent = step.say
    if (step.actor === 'ai') {
      const tag = document.createElement('span')
      tag.className = 'actor'
      tag.textContent = 'I do this'
      li.appendChild(tag)
    }
    list.appendChild(li)
  }
  card.appendChild(list)

  for (const warning of warnings || []) {
    const w = document.createElement('div')
    w.className = 'warn'
    w.textContent = `⚠ ${warning}`
    card.appendChild(w)
  }

  transcript.appendChild(card)
  transcript.scrollTop = transcript.scrollHeight
}

/* ---------------------------------------------------------------------- *
 * Handoff to Part 2
 * ---------------------------------------------------------------------- */

function emitPlan(plan) {
  chrome.runtime.sendMessage({ type: 'PLAN_READY', plan }, () => {
    // Part 2's listener may not exist yet — that's expected while they build,
    // and it must not surface as an error in the chat.
    void chrome.runtime.lastError
  })
}

/* ---------------------------------------------------------------------- *
 * Flow
 * ---------------------------------------------------------------------- */

function handleResult(result) {
  switch (result.status) {
    case 'plan':
      pendingQuestion = null
      // The summary is the plan card's heading — adding it as a message too
      // printed it twice.
      renderPlan(result)
      renderCategoryMatches(result.plan)
      emitPlan(result.plan)
      renderOutgoingPlan(transcript, result.plan) // DEBUG — delete to remove
      window.dispatchEvent(
        new CustomEvent('copilot:assistant-text', { detail: result.plan.summary }),
      )
      break

    case 'needs_input':
      // Asking beats guessing: an invented URL gets typed into a real form.
      pendingQuestion = result
      addMessage('assistant', result.question)
      break

    case 'no_match':
      pendingQuestion = null
      addMessage('assistant', result.message)
      addSuggestions(result.suggestions?.length ? result.suggestions : suggestions())
      break

    default:
      pendingQuestion = null
      addMessage('error', result.message || 'Something went wrong building that plan.')
  }
}

async function ask(text) {
  addMessage('user', text)
  controller.setBusy(true)
  controller.setHint('Working out the steps…')

  try {
    if (pendingQuestion) {
      handleResult(answerAndRetry(pendingQuestion, text, lastGoal))
    } else {
      lastGoal = text
      handleResult(await createPlan(text))
    }
  } catch (err) {
    addMessage('error', err.message || String(err))
  } finally {
    controller.setBusy(false)
    controller.setHint('')
  }
}

/* ---------------------------------------------------------------------- *
 * Boot
 * ---------------------------------------------------------------------- */

/**
 * A first taste of planning against real account state: once we know the site,
 * say which of the user's actual consent categories cover it.
 *
 * This is the shape the state-aware flow will take — the difference between
 * "find the category that matches this site" and "Gap EU — GDPR covers
 * gap.com". Today it annotates the plan; next it will replace those steps.
 */
function renderCategoryMatches(plan) {
  if (plan.recipeId !== 'audit_with_consent_categories' || !lastCategories.length) return

  const host = hostFrom(plan.parameters.siteUrl)
  const ranked = rankForSite(lastCategories, host)
  const matches = ranked.filter(c => c.matches)

  addMessage(
    'note',
    matches.length
      ? `In your account, ${matches.map(c => c.name).join(' and ')} look${matches.length === 1 ? 's' : ''} like ${matches.length === 1 ? 'a match' : 'matches'} for ${host}.`
      : `None of your ${lastCategories.length} consent categories mention ${host} — you'll likely need to create one.`,
  )
}

/**
 * Proves the account bridge end to end: reads the session token from the
 * ObservePoint tab and makes a real authenticated call. This is the foundation
 * state-aware recipes will be built on, so it is worth showing plainly whether
 * it is working rather than discovering later that it never was.
 */
async function showAccount() {
  const state = await accountStatus()

  if (!state.connected) {
    const why = {
      'not-on-observepoint':
        'Open an ObservePoint tab and I can read your account — then I can name the consent categories you actually have instead of guessing.',
      'not-signed-in':
        "You're on ObservePoint but not signed in, so I can't read your account yet.",
    }
    addMessage('note', why[state.reason] ?? `Can't read your account: ${state.reason}`)
    return
  }

  try {
    const categories = await listConsentCategories()
    const line =
      categories.length === 0
        ? `Connected to ${state.environment}. No consent categories in this account yet — I'll walk you through creating one when you need it.`
        : `Connected to ${state.environment}. ${categories.length} consent categor${categories.length === 1 ? 'y' : 'ies'} found: ${categories
            .slice(0, 4)
            .map(c => c.name)
            .join(', ')}${categories.length > 4 ? '…' : ''}`
    addMessage('note', line)
    lastCategories = categories
  } catch (error) {
    addMessage(
      'note',
      `Connected to ${state.environment}, but the category lookup failed: ${error.message}`,
    )
  }
}

async function showMode() {
  const key = await getStoredApiKey()
  statusEl.textContent = key ? 'Gemini' : 'offline matching'
  statusEl.className = `status ${key ? 'live' : 'local'}`
  if (!key) {
    addMessage(
      'note',
      "No API key set, so I'm matching on keywords only — plans still work for common phrasings. Add a Gemini key in the extension Options for better understanding.",
    )
  }
}

controller = mountInput(document.getElementById('input-root'), { onSubmit: ask })

addMessage(
  'system',
  "Tell me what you want to set up and I'll work out the steps, then walk you through them.",
)
addSuggestions(suggestions())
showMode()
showAccount()
