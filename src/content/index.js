import './style.css'
console.log('Content script loaded')

// Create a simple overlay
const overlay = document.createElement('div')
overlay.className = 'chrome-extension-skeleton-overlay'
overlay.textContent = 'Extension Active'
document.body.appendChild(overlay)

// Listen for messages from background/popup (optional demo)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Message received in content script:', request)
})
