import { storage } from '../shared/utils.js'

const colorSelect = document.getElementById('color-select')
const saveBtn = document.getElementById('save')
const status = document.getElementById('status')

function setStatus(message, isError = false) {
  status.textContent = message
  status.style.color = isError ? '#b91c1c' : '#10b981'
}

storage.sync
  .get('color')
  .then(color => {
    if (color) {
      colorSelect.value = color
    }
  })
  .catch(error => {
    setStatus(`Unable to load options: ${error.message}`, true)
    saveBtn.disabled = true
  })

saveBtn.addEventListener('click', async () => {
  const color = colorSelect.value

  try {
    await storage.sync.set('color', color)
    setStatus('Options saved.')

    setTimeout(() => {
      status.textContent = ''
    }, 750)
  } catch (error) {
    setStatus(`Unable to save options: ${error.message}`, true)
  }
})
