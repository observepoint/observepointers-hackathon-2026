/**
 * ============================================================================
 * DEBUG ONLY — shows the exact payload sent to Part 2.
 *
 * TO REMOVE, three deletions and nothing else:
 *   1. this file
 *   2. the import + the renderOutgoingPlan(...) call in sidepanel/main.js
 *      (both tagged `DEBUG`)
 *   3. the `.debug-plan` block at the bottom of sidepanel/style.css
 *
 * Nothing else imports from here, and no other module reads anything it
 * defines — so removing it cannot break the panel.
 * ============================================================================
 */

/**
 * Renders the outgoing PLAN_READY payload as collapsed JSON, with copy and
 * download. Copy is the one that gets used: it's how you hand a real plan to
 * whoever is building the runtime without them having to reproduce your
 * question.
 */
export function renderOutgoingPlan(transcript, plan) {
  const payload = { type: 'PLAN_READY', plan }
  const json = JSON.stringify(payload, null, 2)

  const box = document.createElement('details')
  box.className = 'debug-plan'

  const summary = document.createElement('summary')
  summary.textContent = `⇢ sent to Part 2 · ${plan.recipeId} · ${plan.steps.length} steps`
  box.appendChild(summary)

  const pre = document.createElement('pre')
  pre.textContent = json
  box.appendChild(pre)

  const actions = document.createElement('div')
  actions.className = 'debug-actions'

  const copy = document.createElement('button')
  copy.textContent = 'Copy JSON'
  copy.addEventListener('click', async () => {
    await navigator.clipboard.writeText(json)
    copy.textContent = 'Copied'
    setTimeout(() => (copy.textContent = 'Copy JSON'), 1200)
  })
  actions.appendChild(copy)

  const download = document.createElement('button')
  download.textContent = 'Save as fixture'
  download.addEventListener('click', () => {
    // Saves just the plan, not the message envelope — that's the shape
    // fixtures/ uses, so it can be dropped straight in.
    const blob = new Blob([JSON.stringify(plan, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `plan.${plan.recipeId.replace(/_/g, '-')}.json`
    a.click()
    URL.revokeObjectURL(url)
  })
  actions.appendChild(download)

  box.appendChild(actions)
  transcript.appendChild(box)
  transcript.scrollTop = transcript.scrollHeight
}
