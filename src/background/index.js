console.log('Background service worker started')

// Listen for installation
chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed')
  chrome.contextMenus.create({
    id: 'sampleContextMenu',
    title: 'Sample Context Menu',
    contexts: ['selection'],
  })
})

// Alarms demo
chrome.alarms.create('demo-alarm', { periodInMinutes: 1 })

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'demo-alarm') console.log('Alarm trigger:', new Date().toISOString())
})
