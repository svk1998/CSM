function wantsJson(req) {
  const accept = req.get('accept') || '';
  return req.originalUrl.startsWith('/api/') || accept.includes('application/json');
}

function requireAuth(req, res, next) {
  if (req.session?.userId) {
    return next();
  }

  if (wantsJson(req)) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  return res.redirect('/login');
}

function requireAdmin(req, res, next) {
  if (!req.session?.userId) {
    if (wantsJson(req)) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    return res.redirect('/login');
  }

  if (!req.session.isAdmin) {
    if (wantsJson(req)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    return res.redirect('/');
  }

  return next();
}

function requireWorkspaceUser(req, res, next) {
  if (!req.session?.userId) {
    return res.redirect('/login');
  }

  if (req.session.isAdmin) {
    return res.redirect('/admin');
  }

  return next();
}

module.exports = {
  requireAuth,
  requireAdmin,
  requireWorkspaceUser,
};
