/**
 * Content script — PART 2's territory.
 *
 * Right now this is a receipt: it proves the Part 1 → Part 2 handoff works and
 * gives you something to see while the walkthrough runtime is being built.
 * Open devtools on the page (not the side panel) and ask the Copilot for
 * something — the plan arrives here.
 *
 * Part 2: replace the body of handlePlan() with the real runtime. The message
 * contract is the only thing you have to keep.
 */

function handlePlan(plan) {
  console.groupCollapsed(
    `%c[copilot] PLAN_READY %c${plan.recipeId} — ${plan.steps.length} steps`,
    'color:#2f6df6;font-weight:bold',
    'color:inherit',
  )
  console.log('goal:', plan.goal)
  console.log('summary:', plan.summary)
  console.log('parameters:', plan.parameters)
  console.table(
    plan.steps.map(s => ({
      id: s.id,
      actor: s.actor,
      target: s.targetSelector,
      action: s.action?.type ?? '—',
      completion: s.completion.type,
      say: s.say.length > 60 ? `${s.say.slice(0, 57)}…` : s.say,
    })),
  )

  // A cheap reality check while authoring recipes: does this plan's first step
  // actually exist on the page you're looking at?
  const first = plan.steps[0]
  const found = document.querySelector(first.targetSelector)
  console.log(
    found
      ? `%c✓ step ${first.id} resolves on this page`
      : `%c✗ step ${first.id} does NOT resolve here (${first.targetSelector})`,
    `color:${found ? '#16a34a' : '#dc2626'}`,
  )
  console.groupEnd()
}

chrome.runtime.onMessage.addListener(message => {
  if (message?.type === 'PLAN_READY') handlePlan(message.plan)
})

console.log('[copilot] content script ready — waiting for PLAN_READY')
