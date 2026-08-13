import { storage } from '../shared/utils.js'

const KEY = 'geminiApiKey'

const input = document.getElementById('api-key')
const saveBtn = document.getElementById('save')
const status = document.getElementById('status')

function setStatus(message, isError = false) {
  status.textContent = message
  status.style.color = isError ? '#b91c1c' : '#10b981'
}

storage.sync
  .get(KEY)
  .then(key => {
    if (key) input.value = key
  })
  .catch(error => {
    setStatus(`Unable to load settings: ${error.message}`, true)
    saveBtn.disabled = true
  })

saveBtn.addEventListener('click', async () => {
  const key = input.value.trim()

  try {
    await storage.sync.set(KEY, key)
    setStatus(
      key ? 'Saved. The Copilot will use Gemini.' : 'Cleared. Falling back to keyword matching.',
    )
    setTimeout(() => {
      status.textContent = ''
    }, 1500)
  } catch (error) {
    setStatus(`Unable to save: ${error.message}`, true)
  }
})
