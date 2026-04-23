export function requireAuth(roles = []) {
  const allowed = Array.isArray(roles) ? roles : [roles]
  return (req, res, next) => {
    if (!req.isAuthenticated || !req.isAuthenticated()) {
      return res.status(401).json({ error: 'Unauthenticated' })
    }
    if (allowed.length > 0 && !allowed.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' })
    }
    next()
  }
}

export function requireAuthRedirect(roles = []) {
  const allowed = Array.isArray(roles) ? roles : [roles]
  return (req, res, next) => {
    if (!req.isAuthenticated || !req.isAuthenticated()) {
      return res.redirect('/login')
    }
    if (allowed.length > 0 && !allowed.includes(req.user.role)) {
      return res.redirect('/login')
    }
    next()
  }
}
