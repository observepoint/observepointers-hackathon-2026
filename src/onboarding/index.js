const form = document.getElementById('onboarding-form')
const skipBtn = document.getElementById('skip-btn')
const auditsCheckbox = document.getElementById('audits')
const journeysCheckbox = document.getElementById('journeys')

form.addEventListener('submit', async e => {
  e.preventDefault()

  const interests = []
  if (auditsCheckbox.checked) interests.push('audits')
  if (journeysCheckbox.checked) interests.push('journeys')

  // Save to storage
  await chrome.storage.sync.set({
    interests,
    onboardingComplete: true,
  })

  // Close the tab
  window.close()
})

skipBtn.addEventListener('click', async () => {
  // Mark onboarding as complete even if they skip
  await chrome.storage.sync.set({
    onboardingComplete: true,
  })

  // Close the tab
  window.close()
})
