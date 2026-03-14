const express = require('express');
const httpProxy = require('http-proxy');
const {
  getOrCreateWorkspace,
  getWorkspaceTarget,
  touchWorkspace,
} = require('../docker');
const { requireAuth, requireWorkspaceUser } = require('../middleware/auth');
const logger = require('../logger');

const proxy = httpProxy.createProxyServer({
  changeOrigin: false,
  ws: true,
  xfwd: true,
  proxyTimeout: 60 * 1000,
  timeout: 60 * 1000,
});

proxy.on('error', (error, req, res) => {
  logger.error('Workspace proxy error', {
    error: error.message,
    path: req?.url,
  });

  if (res && !res.headersSent) {
    res.statusCode = 502;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Workspace is unavailable right now. Please try again.');
    return;
  }

  if (res && !res.writableEnded) {
    res.end();
  }
});

proxy.on('proxyReq', (proxyReq, req) => {
  if (req.session?.username) {
    proxyReq.setHeader('X-Forwarded-User', req.session.username);
  }
});

const router = express.Router();

router.use(requireAuth);
router.use(requireWorkspaceUser);
router.use((req, res, next) => {
  const pathname = new URL(req.originalUrl, 'http://127.0.0.1').pathname;
  if (pathname === '/workspace') {
    const search = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    return res.redirect(302, `/workspace/${search}`);
  }

  return next();
});

router.use(async (req, res) => {
  try {
    const workspace = await getOrCreateWorkspace(req.session.userId);
    await touchWorkspace(req.session.userId);
    proxy.web(req, res, { target: getWorkspaceTarget(workspace) });
  } catch (error) {
    logger.error('Failed to serve workspace', {
      error: error.message,
      userId: req.session.userId,
    });
    res.status(502).send('Workspace is unavailable. Please contact your administrator.');
  }
});

module.exports = {
  router,
  proxy,
};
