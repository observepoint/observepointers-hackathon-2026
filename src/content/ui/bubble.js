// The launcher: a circle in the corner of the app, in place of the side panel.
//
// WHY IT REPLACED THE SIDE PANEL
//
// The panel was a second window to look at. Everything it did happens ON the page --
// pointing at controls, highlighting them, waiting for a click -- so the chat sat beside
// the thing it was talking about and the user's eyes had to travel between them. A
// launcher in the corner puts the question where the answer is.
//
// It cost one real thing, and it is worth knowing: SpeechRecognition now runs at the
// PAGE's origin rather than the extension's. See voice.js.
//
// SHAPE
//
//   collapsed   a 48px circle with the logo
//   open        expands LEFT into [mic] [type] [logo]
//   recording   back to a circle, ripple rings
//   asking      a card above the circle with a question and an input
//
// There is one input, and everything commits through it: typing, editing a transcript, and
// answering a question all end up in the same box with the same Ask button.
//
// The bar is anchored by its RIGHT edge, so "expands left" is just the width animating --
// no direction to get wrong. Everything lives in the shadow root from ui/host.js, so the
// app's stylesheets cannot reach it and ours cannot reach the app.

import { getLayer } from './host.js'
import { INJECTED_ATTR } from '../../shared/selectors.js'

const LAYER = 'launcher'

const STATE = {
  COLLAPSED: 'collapsed',
  OPEN: 'open',
}

let nodes = null
let handlers = { onAsk: null, onMicStart: null, onMicStop: null }
let recording = false
// A question we are waiting on. While set, submitting answers THAT rather than asking
// something new -- otherwise "jun@observepoint.com" would be planned as a fresh request.
let pending = null
let dismissTimer = null

function build() {
  const layer = getLayer(LAYER)
  layer.replaceChildren()

  const root = document.createElement('div')
  root.className = 'op-launcher'
  root.setAttribute(INJECTED_ATTR, 'launcher')

  /* ---------------------------- the card ---------------------------- */

  const card = document.createElement('div')
  card.className = 'op-launcher-card'
  card.hidden = true

  const text = document.createElement('p')
  text.className = 'op-launcher-card-text'

  const form = document.createElement('div')
  form.className = 'op-launcher-form'
  form.hidden = true

  const input = document.createElement('textarea')
  input.className = 'op-launcher-input'
  input.rows = 1
  input.setAttribute('aria-label', 'Ask Observe Pointers')
  input.placeholder = 'What are you trying to set up?'

  const send = document.createElement('button')
  send.className = 'op-btn'
  send.type = 'button'
  send.textContent = 'Ask'

  const hint = document.createElement('p')
  hint.className = 'op-launcher-hint'

  form.append(input, send)
  card.append(text, form, hint)

  /* ---------------------------- the bar ----------------------------- */

  const shell = document.createElement('div')
  shell.className = 'op-launcher-shell'

  const bar = document.createElement('div')
  bar.className = 'op-launcher-bar'
  bar.dataset.state = STATE.COLLAPSED
  bar.dataset.recording = 'false'

  // Two rings, offset, so one is always mid-flight.
  for (let i = 0; i < 2; i++) {
    const ring = document.createElement('span')
    ring.className = 'op-launcher-ripple'
    bar.appendChild(ring)
  }

  const mic = slotButton('mic', 'mic', 'Ask by voice')
  const type = slotButton('type', 'chat_bubble_outline', 'Type a question')

  // The logo is both the collapsed launcher and the rightmost slot when open, which is
  // what makes the expansion read as one object growing rather than three appearing.
  const logo = document.createElement('button')
  logo.className = 'op-launcher-btn'
  logo.type = 'button'
  logo.dataset.slot = 'logo'
  logo.setAttribute('aria-label', 'Observe Pointers')
  const img = document.createElement('img')
  img.className = 'op-launcher-logo'
  img.alt = ''
  img.src = chrome.runtime.getURL('icons/observe_pointers_48x48.png')
  logo.appendChild(img)

  bar.append(mic, type, logo)
  shell.appendChild(bar)
  root.append(card, shell)
  layer.appendChild(root)

  nodes = { root, card, text, form, input, send, hint, bar, mic, type, logo }
  wire()
  return nodes
}

function slotButton(slot, ligature, label) {
  const button = document.createElement('button')
  button.className = 'op-launcher-btn'
  button.type = 'button'
  button.dataset.slot = slot
  button.setAttribute('aria-label', label)
  const icon = document.createElement('span')
  icon.className = 'op-icon'
  icon.textContent = ligature
  button.appendChild(icon)
  return button
}

function wire() {
  const { bar, mic, type, logo, input, send } = nodes

  // The logo does double duty: it opens the bar when collapsed and closes it when open.
  // One control, because it is the same object either way.
  logo.addEventListener('click', () => {
    // While recording, the circle is a stop button and nothing else. It releases the mic
    // (voice.js aborts rather than stops) and clears the card, so there is no half state
    // where the rings have gone but something is still listening.
    if (recording) return stopRecording()
    setState(bar.dataset.state === STATE.OPEN ? STATE.COLLAPSED : STATE.OPEN)
  })

  mic.addEventListener('click', () => {
    // Collapse first. The brief says the bar goes back to a circle and ripples, and the
    // reason it reads well is that the ripple needs a circle to ripple from.
    setState(STATE.COLLAPSED)
    startRecording()
  })

  type.addEventListener('click', () => {
    setState(STATE.COLLAPSED)
    openInput()
  })

  send.addEventListener('click', () => commit(input.value))

  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      commit(input.value)
    }
    if (event.key === 'Escape') closeCard()
  })
  input.addEventListener('input', () => {
    input.style.height = 'auto'
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`
  })
}

function setState(state) {
  nodes.bar.dataset.state = state
}

/* ------------------------------------------------------------------ *
 * The card
 * ------------------------------------------------------------------ */

/**
 * How long a message that wants nothing from the user stays up.
 *
 * Replies are read once. Leaving them on screen means the app is permanently wearing a
 * card that has stopped being true -- the walkthrough has moved on and the summary has
 * not. Anything that WANTS something (a question, a transcript to confirm, an open
 * input) is exempt: dismissing a prompt is destroying the interaction.
 */
const DISMISS_MS = 5000

function clearDismiss() {
  if (dismissTimer) clearTimeout(dismissTimer)
  dismissTimer = null
}

function showCard({ message, dim = false, withInput, placeholder, prefill, sticky = false }) {
  const { card, text, form, input } = nodes

  // Every path clears it: a card that replaces another must not inherit its countdown.
  clearDismiss()

  card.hidden = false
  text.textContent = message ?? ''
  text.dataset.dim = String(dim)
  text.hidden = !message

  form.hidden = !withInput

  if (withInput) {
    if (placeholder) input.placeholder = placeholder
    input.value = prefill ?? ''
    input.style.height = 'auto'
    // Focus after paint, or Chrome drops it while the card is still display:none.
    requestAnimationFrame(() => {
      input.focus()
      // Cursor at the end, not selecting everything: the point of editing a transcript is
      // usually to fix one word, and select-all makes the next keystroke destroy it.
      const end = input.value.length
      input.setSelectionRange(end, end)
      input.style.height = `${Math.min(input.scrollHeight, 120)}px`
    })
  }

  // Nothing is being asked for, so it can go by itself.
  //
  // `sticky` is the one case the derivation cannot see: a card that wants an action the
  // card itself does not offer. "Reload the page" is the example — there is no button to
  // press here, the user has to go and do something, and taking the message away after
  // five seconds leaves a launcher that silently does nothing.
  if (!withInput && !sticky) {
    dismissTimer = setTimeout(closeCard, DISMISS_MS)
  }
}

function closeCard() {
  clearDismiss()
  nodes.card.hidden = true
  nodes.form.hidden = true
  nodes.hint.textContent = ''
  pending = null
}

function openInput(prefill = '') {
  showCard({
    withInput: true,
    prefill,
    placeholder: 'What are you trying to set up?',
  })
}

/** The one door out. Typed, edited or spoken, everything commits through here. */
function commit(raw) {
  const value = String(raw ?? '').trim()
  if (!value) return

  nodes.input.value = ''
  nodes.input.style.height = 'auto'

  // An outstanding question owns the next thing said. Without this the answer to
  // "who should this alert email?" would be planned as a brand-new request.
  const answering = pending
  pending = null
  handlers.onAsk?.(value, answering)
}

/* ------------------------------------------------------------------ *
 * Voice
 * ------------------------------------------------------------------ */

function startRecording() {
  if (recording) return
  recording = true
  nodes.bar.dataset.recording = 'true'
  showCard({ message: 'Listening… pause when you are done.', dim: true })
  handlers.onMicStart?.()
}

function stopRecording() {
  if (!recording) return
  recording = false
  nodes.bar.dataset.recording = 'false'
  // Nothing was accepted, so nothing should be left on screen suggesting otherwise.
  closeCard()
  handlers.onMicStop?.()
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

/**
 * @param {object} callbacks
 * @param {(text: string, answering: object|null) => void} callbacks.onAsk
 * @param {() => void} callbacks.onMicStart
 * @param {() => void} callbacks.onMicStop
 */
export function mountBubble(callbacks = {}) {
  handlers = { ...handlers, ...callbacks }
  if (!nodes || !nodes.root.isConnected) build()
  return { ask: openInput, toggle: toggleBubble }
}

/** The toolbar action, and anything else that wants to bring it forward. */
export function toggleBubble() {
  if (!nodes) return
  if (!nodes.card.hidden) return closeCard()
  setState(nodes.bar.dataset.state === STATE.OPEN ? STATE.COLLAPSED : STATE.OPEN)
}

/** Live transcript while the mic is on. */
export function showTranscript(partial) {
  if (!nodes) return
  // Straight to the node rather than through showCard: this fires on every syllable, and
  // it must not restart an auto-dismiss timer or steal focus mid-sentence.
  clearDismiss()
  nodes.text.textContent = partial || 'Listening… pause when you are done.'
  nodes.text.dataset.dim = String(!partial)
  nodes.text.hidden = false
  nodes.card.hidden = false
}

/** Voice finished: drop out of recording state so the rings stop. */
export function recordingEnded() {
  if (!nodes) return
  recording = false
  nodes.bar.dataset.recording = 'false'
}

/**
 * What the mic heard, held for confirmation rather than sent.
 *
 * A transcript is a guess. It renders the demo sentence as "observe point dot com" often
 * enough that sending it unseen is a coin toss on the one interaction people are watching
 * — and the fingerprint in demo.js exists precisely because that guess is unreliable.
 *
 * So: show it, Ask to accept, pencil to fix. No auto-dismiss, because this is waiting on
 * a decision and taking it away would make it.
 */
export function confirmTranscript(text) {
  if (!nodes) build()
  const heard = String(text ?? '').trim()
  if (!heard) return

  setState(STATE.COLLAPSED)
  // Into the SAME box typing uses, already filled and focused, with the same Ask button.
  //
  // The first version showed it read-only with a pencil beside it, which was worse in
  // every way: an extra control to find, an extra click for the common case, a second
  // path into the planner, and a state where the text on screen was not the text in the
  // field. Prefilling the one input makes the sentence editable by definition, so there
  // is nothing to add an edit affordance to.
  showCard({ withInput: true, prefill: heard, placeholder: 'What are you trying to set up?' })
}

/**
 * A question the planner needs answered before it can build anything — the alert's email
 * address, on the demo path. Pops the card above the circle and opens the input, which is
 * the whole reason the card and the input are one component.
 *
 * @param {object} question the `needs_input` result, handed back on submit
 */
export function askQuestion(question) {
  if (!nodes) build()
  pending = question
  setState(STATE.COLLAPSED)
  // withInput, so it is exempt from the auto-dismiss: taking a question away five seconds
  // after asking it would strand the whole chain waiting for an answer nobody can give.
  showCard({ message: question.question, withInput: true, placeholder: 'Type your answer…' })
}

/**
 * One line of reply. Not a transcript — the walkthrough itself is the output.
 *
 * Auto-dismisses, because it wants nothing back. See DISMISS_MS.
 */
export function say(message, { dim = false, sticky = false } = {}) {
  if (!nodes) build()
  showCard({ message, dim, withInput: false, sticky })
}

export function setHint(message = '') {
  if (nodes) nodes.hint.textContent = message
}

export function setBusy(busy) {
  if (!nodes) return
  nodes.send.disabled = busy
  nodes.input.disabled = busy
}

export function hideBubble() {
  if (nodes?.root) nodes.root.remove()
  nodes = null
}
