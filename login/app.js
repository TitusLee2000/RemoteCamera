const setupSection = document.getElementById('setup-section')
const loginSection = document.getElementById('login-section')
const setupForm = document.getElementById('setup-form')
const setupEmail = document.getElementById('setup-email')
const setupPassword = document.getElementById('setup-password')
const setupError = document.getElementById('setup-error')
const dashboardForm = document.getElementById('dashboard-form')
const registerForm = document.getElementById('register-form')
const cameraForm = document.getElementById('camera-form')
const loginEmail = document.getElementById('login-email')
const loginPassword = document.getElementById('login-password')
const loginError = document.getElementById('login-error')
const regEmail = document.getElementById('reg-email')
const regPassword = document.getElementById('reg-password')
const regConfirm = document.getElementById('reg-confirm')
const registerError = document.getElementById('register-error')
const cameraCode = document.getElementById('camera-code')
const cameraError = document.getElementById('camera-error')
const tabDashboard = document.getElementById('tab-dashboard')
const tabRegister = document.getElementById('tab-register')
const tabCamera = document.getElementById('tab-camera')

function showError(el, msg) {
  el.textContent = msg
  el.hidden = false
}
function hideError(el) { el.hidden = true }

function showTab(activeTab, activeForm) {
  ;[tabDashboard, tabRegister, tabCamera].forEach(t => t.classList.remove('active'))
  ;[dashboardForm, registerForm, cameraForm].forEach(f => { f.hidden = true })
  activeTab.classList.add('active')
  activeForm.hidden = false
}

async function init() {
  const res = await fetch('/api/auth/first-run')
  const { firstRun } = await res.json()
  if (firstRun) {
    setupSection.hidden = false
  } else {
    loginSection.hidden = false
    showTab(tabDashboard, dashboardForm)
  }
}

tabDashboard.addEventListener('click', () => showTab(tabDashboard, dashboardForm))
tabRegister.addEventListener('click', () => showTab(tabRegister, registerForm))
tabCamera.addEventListener('click', () => showTab(tabCamera, cameraForm))

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
  window.location.href = '/'
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
  window.location.href = '/'
})

registerForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  hideError(registerError)
  if (regPassword.value !== regConfirm.value) {
    showError(registerError, 'Passwords do not match')
    return
  }
  const btn = registerForm.querySelector('button')
  btn.disabled = true
  const res = await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: regEmail.value, password: regPassword.value }),
  })
  const data = await res.json()
  if (!res.ok) {
    showError(registerError, data.error)
    btn.disabled = false
    return
  }
  window.location.href = '/'
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
