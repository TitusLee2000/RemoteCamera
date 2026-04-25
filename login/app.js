const setupSection = document.getElementById('setup-section')
const loginSection = document.getElementById('login-section')
const setupForm = document.getElementById('setup-form')
const setupEmail = document.getElementById('setup-email')
const setupPassword = document.getElementById('setup-password')
const setupError = document.getElementById('setup-error')
const dashboardForm = document.getElementById('dashboard-form')
const cameraForm = document.getElementById('camera-form')
const loginEmail = document.getElementById('login-email')
const loginPassword = document.getElementById('login-password')
const loginError = document.getElementById('login-error')
const cameraCode = document.getElementById('camera-code')
const cameraError = document.getElementById('camera-error')
const tabDashboard = document.getElementById('tab-dashboard')
const tabCamera = document.getElementById('tab-camera')

function showError(el, msg) {
  el.textContent = msg
  el.hidden = false
}
function hideError(el) { el.hidden = true }

async function init() {
  const res = await fetch('/api/auth/first-run')
  const { firstRun } = await res.json()
  if (firstRun) {
    setupSection.hidden = false
  } else {
    loginSection.hidden = false
  }
}

tabDashboard.addEventListener('click', () => {
  tabDashboard.classList.add('active')
  tabCamera.classList.remove('active')
  dashboardForm.hidden = false
  cameraForm.hidden = true
})
tabCamera.addEventListener('click', () => {
  tabCamera.classList.add('active')
  tabDashboard.classList.remove('active')
  cameraForm.hidden = false
  dashboardForm.hidden = true
})

setupForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  hideError(setupError)
  const btn = setupForm.querySelector('button')
  btn.disabled = true
  const res = await fetch('/api/auth/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: setupEmail.value, password: setupPassword.value }),
  })
  const data = await res.json()
  if (!res.ok) {
    showError(setupError, data.error)
    btn.disabled = false
    return
  }
  window.location.href = '/admin'
})

dashboardForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  hideError(loginError)
  const btn = dashboardForm.querySelector('button')
  btn.disabled = true
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: loginEmail.value, password: loginPassword.value, rememberMe: document.getElementById('remember-me').checked }),
  })
  const data = await res.json()
  if (!res.ok) {
    showError(loginError, data.error)
    btn.disabled = false
    return
  }
  window.location.href = data.role === 'admin' ? '/admin' : '/'
})

cameraForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  hideError(cameraError)
  const btn = cameraForm.querySelector('button')
  btn.disabled = true
  const res = await fetch('/api/slots/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: cameraCode.value.trim() }),
  })
  const data = await res.json()
  if (!res.ok) {
    showError(cameraError, data.error ?? 'Invalid access code')
    btn.disabled = false
    return
  }
  window.location.href = `/client?code=${encodeURIComponent(cameraCode.value.trim())}`
})

init()
