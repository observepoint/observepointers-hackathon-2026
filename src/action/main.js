import { storage } from '../shared/utils.js'

const countElement = document.getElementById('count')
const incrementBtn = document.getElementById('increment')
const optionsLink = document.getElementById('go-to-options')
const statusElement = document.getElementById('status')

function showStatus(message) {
  statusElement.textContent = message
}

async function initializePopup() {
  try {
    const [count, color] = await Promise.all([
      storage.local.get('count'),
      storage.sync.get('color'),
    ])

    countElement.textContent = count ?? 0

    if (color) document.body.style.backgroundColor = color
  } catch (error) {
    countElement.textContent = '0'
    incrementBtn.disabled = true
    showStatus(`Unable to load saved data: ${error.message}`)
  }
}

initializePopup()

incrementBtn.addEventListener('click', async () => {
  const current = Number.parseInt(countElement.textContent, 10)
  const next = current + 1

  try {
    await storage.local.set('count', next)
    countElement.textContent = next
    showStatus('')
  } catch (error) {
    showStatus(`Unable to save count: ${error.message}`)
  }
})

optionsLink.addEventListener('click', () => {
  chrome.runtime.openOptionsPage()
})
