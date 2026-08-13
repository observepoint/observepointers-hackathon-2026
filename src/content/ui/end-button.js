// The "End Walkthrough" bar: floats above everything while a walkthrough is running.
//
// Presentational only. It renders whatever state it's handed and reports one thing back
// — the user wants to stop. The page layer owns the state; it calls reportState() and
// this updates itself.
//
// Pinned top-centre deliberately. Bottom-right is Intercom's messenger launcher (loaded
// via GTM on this app) and the bottom edge is where the app's own toasts appear.

import { Z_INDEX } from '../../shared/selectors.js'
import { getLayer, clearLayer } from './host.js'

const LAYER = 'end-button'

let nodes = null
let onEnd = null

function build() {
  const layer = getLayer(LAYER)
  layer.innerHTML = ''

  const bar = document.createElement('div')
  bar.className = 'op-statusbar'
  bar.style.zIndex = String(Z_INDEX.END_BUTTON)
  bar.setAttribute('role', 'status')

  const top = document.createElement('div')
  top.className = 'op-statusbar-top'

  const dot = document.createElement('span')
  dot.className = 'op-statusbar-dot'

  const label = document.createElement('span')
  label.className = 'op-statusbar-label'

  const progress = document.createElement('span')
  progress.className = 'op-statusbar-progress'

  const end = document.createElement('button')
  end.className = 'op-btn op-btn--sm'
  end.type = 'button'
  end.textContent = 'End walkthrough'
  end.onclick = () => onEnd?.()

  top.append(dot, label, progress, end)

  const say = document.createElement('p')
  say.className = 'op-statusbar-say'

  bar.append(top, say)
  layer.appendChild(bar)

  return { bar, dot, label, progress, say }
}

/**
 * Render walkthrough state. Called by the page layer via reportState().
 *
 * @param {object} state { status: 'running'|'paused'|'idle', goal, currentStepIndex,
 *                         totalSteps, say, error, queued }
 */
export function sync(state) {
  if (!state || state.status === 'idle') {
    hide()
    return
  }

  // Rebuild if something removed our node — cheap, and keeps this resilient to the app
  // re-rendering underneath us.
  nodes = nodes && getLayer(LAYER).contains(nodes.bar) ? nodes : build()

  const paused = state.status === 'paused'

  nodes.label.textContent = state.goal ?? 'Walkthrough in progress'

  const step = state.totalSteps
    ? `Step ${Math.min((state.currentStepIndex ?? 0) + 1, state.totalSteps)} of ${state.totalSteps}`
    : ''
  const queued = state.queued ? `${state.queued} more to come` : ''
  nodes.progress.textContent = [step, queued].filter(Boolean).join(' · ')

  nodes.dot.dataset.paused = String(paused)
  nodes.say.textContent = paused ? (state.error ?? 'Paused.') : (state.say ?? '')
  nodes.say.dataset.error = String(paused)
}

/** Register the end handler. */
export function setEndHandler(handler) {
  onEnd = handler
}

export function hide() {
  nodes = null
  clearLayer(LAYER)
}
