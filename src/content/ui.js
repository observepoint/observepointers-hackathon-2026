// Visual layer for guided walkthroughs: highlights, tooltips, confetti, completion popup.
// All DOM mutations here are scoped to injected elements so they never touch app markup.

const HIGHLIGHT_STYLE_ID = 'op-wt-highlight-style'
const TOOLTIP_ID = 'op-wt-tooltip'

function injectHighlightStyle() {
  if (document.getElementById(HIGHLIGHT_STYLE_ID)) return
  const style = document.createElement('style')
  style.id = HIGHLIGHT_STYLE_ID
  style.textContent = `
    @keyframes op-wt-pulse {
      0%, 100% { box-shadow: 0 0 0 3px #ffd700, 0 0 10px 4px rgba(255, 215, 0, 0.4); }
      50%       { box-shadow: 0 0 0 3px #ffd700, 0 0 20px 8px rgba(255, 215, 0, 0.7); }
    }
    .op-wt-highlight {
      animation: op-wt-pulse 1.5s ease-in-out infinite !important;
      outline: none !important;
    }
  `
  document.head.appendChild(style)
}

export function highlightElement(el) {
  injectHighlightStyle()
  el.classList.add('op-wt-highlight')
}

export function unhighlightElement(el) {
  el.classList.remove('op-wt-highlight')
}

/**
 * @param {object} [options]
 * @param {string} [options.label]         Button text. "Continue →" when the step is
 *                                         waiting on the user to read or confirm
 *                                         something, "Next →" when it is a fallback.
 * @param {number} [options.revealAfterMs] Hide the button for this long. 0 shows it
 *                                         immediately. Used for steps that advance on
 *                                         their own: no button while detection has a
 *                                         fair chance, a button once it clearly hasn't.
 */
export function showTooltip(element, text, stepIndex, totalSteps, onNext, options = {}) {
  removeTooltip()

  const { label = 'Next →', revealAfterMs = 0 } = options

  const tip = document.createElement('div')
  tip.id = TOOLTIP_ID
  tip.style.cssText = `
    position: fixed;
    z-index: 2147483002;
    background: #1a1a2e;
    color: #fff;
    border: 2px solid #ffd700;
    border-radius: 8px;
    padding: 12px 16px;
    max-width: 300px;
    font-family: sans-serif;
    font-size: 14px;
    line-height: 1.5;
    box-shadow: 0 4px 20px rgba(0,0,0,0.5);
    pointer-events: none;
  `
  tip.innerHTML = `
    <div style="font-size:11px;color:#ffd700;font-weight:600;letter-spacing:0.5px;margin-bottom:6px;">
      STEP ${stepIndex + 1} OF ${totalSteps}
    </div>
    <div>${text}</div>
    ${
      onNext
        ? `
    <button id="op-wt-next-btn" style="
      margin-top: 10px;
      width: 100%;
      background: #ffd700;
      color: #1a1a2e;
      border: none;
      border-radius: 6px;
      padding: 7px 16px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      display: ${revealAfterMs > 0 ? 'none' : 'block'};
      pointer-events: auto;
    ">${label}</button>`
        : ''
    }
  `
  document.body.appendChild(tip)

  if (onNext) {
    const button = document.getElementById('op-wt-next-btn')
    button.addEventListener('click', onNext)

    if (revealAfterMs > 0) {
      // Reveal in place rather than re-render: the tooltip is already positioned,
      // and growing it by one button is less startling than it moving.
      const timer = setTimeout(() => {
        // The step may have finished and torn this tooltip down already.
        if (!button.isConnected) return
        button.style.display = 'block'
        button.textContent = 'Skip this step →'
      }, revealAfterMs)
      tooltipTimers.push(timer)
    }
  }

  placeAbove(tip, element)
}

// Shared card styling for the step tooltip and the guard tooltip, so the two read as the same
// object rather than two things that happen to be dark and gold.
const TOOLTIP_CARD_CSS = `
  position: fixed;
  z-index: 2147483002;
  background: #1a1a2e;
  color: #fff;
  border: 2px solid #ffd700;
  border-radius: 8px;
  padding: 12px 16px;
  max-width: 300px;
  font-family: sans-serif;
  font-size: 14px;
  line-height: 1.5;
  box-shadow: 0 4px 20px rgba(0,0,0,0.5);
`

// Sit above the target, flip below when that would clip the top, and stay inside the viewport
// horizontally. Measured after insertion because we need the card's real height.
function placeAbove(tip, element) {
  const rect = element.getBoundingClientRect()
  const tipRect = tip.getBoundingClientRect()

  let top = rect.top - tipRect.height - 12
  const isAbove = top >= 8
  if (!isAbove) top = rect.bottom + 12

  let left = rect.left + rect.width / 2 - tipRect.width / 2
  left = Math.max(8, Math.min(left, window.innerWidth - tipRect.width - 8))

  tip.style.top = `${top}px`
  tip.style.left = `${left}px`

  const arrowLeft = Math.max(8, Math.min(rect.left + rect.width / 2 - left - 5, tipRect.width - 18))
  const arrow = document.createElement('div')
  arrow.style.cssText = `
    position: absolute;
    ${isAbove ? 'bottom: -6px' : 'top: -6px'};
    left: ${arrowLeft}px;
    width: 10px;
    height: 10px;
    background: #1a1a2e;
    ${
      isAbove
        ? 'border-right: 2px solid #ffd700; border-bottom: 2px solid #ffd700;'
        : 'border-left: 2px solid #ffd700; border-top: 2px solid #ffd700;'
    }
    transform: rotate(45deg);
  `
  tip.appendChild(arrow)
}

// Pending reveal timers, cleared with the tooltip so a torn-down step can't
// resurrect a button on the next one.
const tooltipTimers = []

export function removeTooltip() {
  while (tooltipTimers.length) clearTimeout(tooltipTimers.pop())
  document.getElementById(TOOLTIP_ID)?.remove()
}

const GUARD_TOOLTIP_ID = 'op-wt-guard-tooltip'

/**
 * Point at the control that would resolve a violated guard.
 *
 * The step tooltip's sibling, with the remedy's title where STEP n OF m goes and no Next
 * button: this one is dismissed by the user fixing the state, not by acknowledging it.
 */
export function showGuardTooltip(element, { title, say }) {
  hideGuardTooltip()

  const tip = document.createElement('div')
  tip.id = GUARD_TOOLTIP_ID
  tip.setAttribute('role', 'alert')
  tip.style.cssText = `${TOOLTIP_CARD_CSS} pointer-events: none;`

  const heading = document.createElement('div')
  heading.style.cssText =
    'font-size:11px;color:#ffd700;font-weight:600;letter-spacing:0.5px;margin-bottom:6px;'
  heading.textContent = title.toUpperCase()

  const body = document.createElement('div')
  body.textContent = say

  tip.append(heading, body)
  document.body.appendChild(tip)

  placeAbove(tip, element)
}

export function hideGuardTooltip() {
  document.getElementById(GUARD_TOOLTIP_ID)?.remove()
}

export function showConfetti() {
  const colors = ['#ffd700', '#ffed4a', '#ffc107', '#ffe066', '#ffb300', '#fff3cd']
  const container = document.createElement('div')
  container.style.cssText = `
    position: fixed; inset: 0; pointer-events: none; z-index: 2147483003; overflow: hidden;
  `

  const style = document.createElement('style')
  style.textContent = `
    @keyframes op-wt-confetti-fall {
      0%   { transform: translateY(-10px) rotate(0deg); opacity: 1; }
      100% { transform: translateY(110vh) rotate(720deg); opacity: 0; }
    }
  `
  container.appendChild(style)

  for (let i = 0; i < 80; i++) {
    const piece = document.createElement('div')
    const color = colors[i % colors.length]
    const size = 6 + (i % 5) * 2
    const left = (i * 1.27) % 100
    const delay = (i * 0.04) % 1.5
    const duration = 2 + (i % 3) * 0.5
    piece.style.cssText = `
      position: absolute;
      left: ${left}%;
      top: -10px;
      width: ${size}px;
      height: ${size}px;
      background: ${color};
      border-radius: ${i % 3 === 0 ? '50%' : '2px'};
      animation: op-wt-confetti-fall ${duration}s ${delay}s ease-in forwards;
    `
    container.appendChild(piece)
  }

  document.body.appendChild(container)
  setTimeout(() => container.remove(), 4000)
}

export function showCompletionPopup(goal) {
  const popup = document.createElement('div')
  popup.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 2147483004;
    background: #1a1a2e;
    border: 2px solid #ffd700;
    border-radius: 12px;
    padding: 32px 40px;
    text-align: center;
    font-family: sans-serif;
    color: #fff;
    box-shadow: 0 8px 40px rgba(0,0,0,0.6);
    min-width: 320px;
  `
  popup.innerHTML = `
    <div style="font-size:40px;margin-bottom:12px;">🏆</div>
    <div style="font-size:20px;font-weight:700;color:#ffd700;margin-bottom:8px;">Walkthrough Complete!</div>
    <div style="font-size:15px;color:#ccc;margin-bottom:24px;">${goal}</div>
    <button id="op-wt-close-popup" style="
      background: #ffd700;
      color: #1a1a2e;
      border: none;
      border-radius: 6px;
      padding: 10px 24px;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
    ">Done</button>
  `
  document.body.appendChild(popup)
  document.getElementById('op-wt-close-popup').addEventListener('click', () => popup.remove())
  setTimeout(() => popup.remove(), 6000)
}

const GUARD_ID = 'op-wt-guard-popup'

/**
 * Show the "put this back" prompt for a violated guard.
 *
 * Unlike every other popup here this one does NOT auto-dismiss and has no button: it is
 * removed by hideGuardPopup() the moment the state it is asking for comes back. A timeout
 * would leave the walkthrough silently stalled with nothing on screen explaining why.
 */
export function showGuardPopup({ title, say }) {
  if (document.getElementById(GUARD_ID)) return

  const popup = document.createElement('div')
  popup.id = GUARD_ID
  popup.setAttribute('role', 'alert')
  popup.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 2147483004;
    background: #1a1a2e;
    border: 2px solid #ffd700;
    border-radius: 12px;
    padding: 28px 36px;
    text-align: center;
    font-family: sans-serif;
    color: #fff;
    box-shadow: 0 8px 40px rgba(0,0,0,0.6);
    min-width: 320px;
    max-width: 400px;
  `
  popup.innerHTML = `
    <div style="font-size:28px;margin-bottom:12px;">📌</div>
    <div style="font-size:16px;font-weight:700;color:#ffd700;margin-bottom:8px;"></div>
    <div style="font-size:14px;color:#fff;line-height:1.5;"></div>
    <div style="font-size:12px;color:#888;margin-top:16px;">This closes itself once you do. Or end the walkthrough from the bar at the top.</div>
  `
  // textContent rather than interpolation: the copy is ours, but every other popup here
  // interpolates and that is a habit worth not spreading.
  popup.children[1].textContent = title
  popup.children[2].textContent = say

  document.body.appendChild(popup)
}

export function hideGuardPopup() {
  document.getElementById(GUARD_ID)?.remove()
}

export function showPrerequisitePopup(goal, instruction) {
  const popup = document.createElement('div')
  popup.id = 'op-wt-prereq-popup'
  popup.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 2147483004;
    background: #1a1a2e;
    border: 2px solid #ffd700;
    border-radius: 12px;
    padding: 32px 40px;
    text-align: center;
    font-family: sans-serif;
    color: #fff;
    box-shadow: 0 8px 40px rgba(0,0,0,0.6);
    min-width: 320px;
    max-width: 400px;
  `
  popup.innerHTML = `
    <div style="font-size:28px;margin-bottom:12px;">👋</div>
    <div style="font-size:16px;font-weight:700;color:#ffd700;margin-bottom:8px;">Before you begin</div>
    <div style="font-size:13px;color:#aaa;margin-bottom:12px;">To start <em>${goal}</em>, you first need to:</div>
    <div style="font-size:14px;color:#fff;line-height:1.5;margin-bottom:24px;">${instruction}</div>
    <button id="op-wt-prereq-close" style="
      background: #ffd700;
      color: #1a1a2e;
      border: none;
      border-radius: 6px;
      padding: 10px 24px;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
    ">Got it</button>
  `
  document.body.appendChild(popup)
  document.getElementById('op-wt-prereq-close').addEventListener('click', () => popup.remove())
  setTimeout(() => popup.remove(), 10000)
}
