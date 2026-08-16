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
import { getStoredApiKey } from '../planner/llm.js'
import {
  status as accountStatus,
  listConsentCategories,
  probeApi,
  checkSelectors,
} from '../planner/account.js'

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

  // Verification affordance: stand on the relevant screen, press this, and the
  // page says which of the plan's selectors actually resolve. That is what
  // clears an `unverified: true` flag honestly.
  const check = document.createElement('button')
  check.className = 'chip'
  check.textContent = 'Check selectors on this screen'
  check.addEventListener('click', () => runSelectorCheck(plan, card, check))
  card.appendChild(check)

  transcript.appendChild(card)
  transcript.scrollTop = transcript.scrollHeight
}

async function runSelectorCheck(plan, card, button) {
  button.disabled = true
  button.textContent = 'Checking…'

  try {
    const { results, page } = await checkSelectors(plan.steps)
    const output = document.createElement('pre')
    output.className = 'selector-check'
    output.textContent = results
      .map(r => {
        const mark = r.visible ? '✓' : r.found ? '·' : '✗'
        const note = r.visible
          ? r.text
            ? `visible — "${r.text}"`
            : 'visible'
          : r.found
            ? 'in DOM but hidden (wrong screen?)'
            : (r.error ?? 'not found')
        return `${mark} ${r.id}  ${note}\n   ${r.selector}`
      })
      .join('\n')
    // Lead with where we looked. Without it, "0/9" reads as "the selectors are
    // wrong" when the real answer is almost always "wrong screen".
    output.textContent = `on ${page?.screen ?? 'unknown'} — ${page?.url ?? ''}\n\n${output.textContent}`
    card.appendChild(output)

    const visible = results.filter(r => r.visible).length
    button.textContent = `${visible}/${results.length} resolve on ${page?.screen ?? 'this screen'}`
  } catch (error) {
    button.textContent = `Check failed: ${error.message}`
  }
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

/** Whatever we managed to read from the account, for state-aware recipes. */
function accountContext() {
  return { account: lastCategories.length ? { consentCategories: lastCategories } : null }
}

async function ask(text) {
  addMessage('user', text)
  controller.setBusy(true)
  controller.setHint('Working out the steps…')

  try {
    if (pendingQuestion) {
      handleResult(answerAndRetry(pendingQuestion, text, lastGoal, accountContext()))
    } else {
      lastGoal = text
      handleResult(await createPlan(text, { account: accountContext().account }))
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
    addMessage(
      'note',
      why[state.reason] ??
        `Can't read your account: ${state.reason}${state.hostname ? ` (${state.hostname})` : ''}`,
    )
    return
  }

  try {
    const categories = await listConsentCategories()
    const line =
      categories.length === 0
        ? `Connected to ${state.environment} (${state.hostname}). No consent categories in this account yet — I'll walk you through creating one when you need it.`
        : `Connected to ${state.environment} (${state.hostname}). ${categories.length} consent categor${categories.length === 1 ? 'y' : 'ies'} found: ${categories
            .slice(0, 4)
            .map(c => c.name)
            .join(', ')}${categories.length > 4 ? '…' : ''}`
    addMessage('note', line)
    lastCategories = categories
  } catch (error) {
    addMessage(
      'note',
      `Connected to ${state.environment} (${state.hostname}), but the category lookup failed: ${error.message}\nProbing which API paths and hosts actually answer…`,
    )

    // Probe automatically. This only runs when something is already broken, and
    // "which path reaches the API from this origin" is the first thing anyone
    // would want to know — guessing it one round-trip at a time is worse.
    const results = await probeApi()
    addMessage(
      'note',
      results
        .map(r => `${r.ok ? '✓' : '✗'} ${r.base}${r.path}\n     ${r.status} ${r.detail}`)
        .join('\n'),
    )
    console.table(results)
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
