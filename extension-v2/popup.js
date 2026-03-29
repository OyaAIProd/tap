const statusEl = document.getElementById('status')
const tapsEl = document.getElementById('taps')

chrome.runtime.sendMessage({ action: 'list' }, (response) => {
  if (!response || response.error) {
    statusEl.textContent = 'error: ' + (response?.error || 'no response')
    return
  }

  const taps = response.taps || []
  statusEl.textContent = `${taps.length} taps loaded`
  statusEl.classList.add('connected')

  if (taps.length === 0) {
    tapsEl.innerHTML = '<li class="empty">no taps registered</li>'
    return
  }

  for (const tap of taps) {
    const li = document.createElement('li')
    li.innerHTML = `<span class="site">${tap.site}</span>/<span class="name">${tap.name}</span><span class="desc">${tap.description}</span>`
    li.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'run', site: tap.site, name: tap.name }, (result) => {
        console.log(`tap://${tap.site}/${tap.name}`, result)
      })
    })
    tapsEl.appendChild(li)
  }
})
