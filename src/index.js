require('dotenv').config();

const fs = require('fs');
const http = require('http');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);

const { config, validateConfig } = require('./config');
const logger = require('./logger');
const { pool, migrate, query, closePool } = require('./db');
const { pingDocker, stopIdleWorkspaces, getOrCreateWorkspace, getWorkspaceTarget, touchWorkspace } = require('./docker');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const { router: workspaceRouter, proxy } = require('./routes/workspace');
const { requireAdmin } = require('./middleware/auth');

fs.mkdirSync(path.join(process.cwd(), 'logs'), { recursive: true });

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy);

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

const sessionMiddleware = session({
  store: new pgSession({
    pool,
    tableName: 'sessions',
    createTableIfMissing: false,
  }),
  name: config.sessionCookieName,
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    maxAge: config.sessionMaxAgeMs,
  },
});

app.use(sessionMiddleware);
app.use((req, res, next) => {
  if (req.session?.userId) {
    res.set('Cache-Control', 'no-store');
  }
  next();
});

app.use('/api', apiLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);

app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/', (req, res) => {
  if (!req.session?.userId) {
    return res.redirect('/login');
  }

  if (req.session.isAdmin) {
    return res.redirect('/admin');
  }

  return res.redirect('/workspace/');
});

app.get('/login', (req, res) => {
  return res.sendFile(path.join(__dirname, '..', 'public', 'login.html'));
});

app.get('/admin', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
});

app.use('/workspace', workspaceRouter);

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
  });
});

app.get('/ready', async (req, res) => {
  try {
    await query('SELECT 1');
    if (!config.skipDockerPing) {
      await pingDocker();
    }

    return res.json({ status: 'ready' });
  } catch (error) {
    return res.status(503).json({
      status: 'not-ready',
      error: error.message,
    });
  }
});

app.use((req, res) => {
  if (req.originalUrl.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }

  return res.status(404).send('Not found');
});

app.use((error, req, res, next) => {
  logger.error('Unhandled application error', {
    error: error.message,
    path: req.originalUrl,
  });

  if (res.headersSent) {
    return next(error);
  }

  if (req.originalUrl.startsWith('/api/')) {
    return res.status(500).json({ error: 'Internal server error' });
  }

  return res.status(500).send('Internal server error');
});

let server;
let cleanupTimer;

function getUpgradePath(rawUrl) {
  const parsed = new URL(rawUrl, 'http://127.0.0.1');
  const strippedPath = parsed.pathname.startsWith('/workspace')
    ? parsed.pathname.replace(/^\/workspace(?=\/|$)/, '') || '/'
    : parsed.pathname || '/';
  return `${strippedPath}${parsed.search}`;
}

async function handleUpgrade(req, socket, head) {
  const responseShim = new http.ServerResponse(req);

  sessionMiddleware(req, responseShim, async (sessionError) => {
    if (sessionError) {
      logger.error('Session parse failed during websocket upgrade', { error: sessionError.message });
      socket.destroy();
      return;
    }

    if (!req.session?.userId || req.session.isAdmin) {
      socket.destroy();
      return;
    }

    try {
      const workspace = await getOrCreateWorkspace(req.session.userId);
      await touchWorkspace(req.session.userId);
      const originalUrl = req.url;
      req.url = getUpgradePath(req.url);
      logger.info('Proxying workspace websocket', {
        userId: req.session.userId,
        originalUrl,
        proxiedUrl: req.url,
      });
      proxy.ws(req, socket, head, {
        target: getWorkspaceTarget(workspace),
      });
    } catch (error) {
      logger.error('Workspace websocket proxy failed', {
        error: error.message,
        userId: req.session?.userId,
      });
      socket.destroy();
    }
  });
}

async function shutdown(signal) {
  logger.info('Shutting down application', { signal });
  clearInterval(cleanupTimer);

  await new Promise((resolve) => {
    if (!server) {
      resolve();
      return;
    }

    server.close(() => resolve());
  });

  await closePool();
  process.exit(0);
}

async function start() {
  const warnings = validateConfig();
  warnings.forEach((message) => logger.warn('Configuration warning', { message }));

  await migrate();
  logger.info('Database migrations complete');

  if (!config.skipDockerPing) {
    await pingDocker();
    logger.info('Docker connectivity verified');
  } else {
    logger.warn('Docker ping check skipped because SKIP_DOCKER_PING=true');
  }

  cleanupTimer = setInterval(() => {
    stopIdleWorkspaces().catch((error) => {
      logger.error('Idle workspace cleanup failed', { error: error.message });
    });
  }, config.cleanupIntervalMinutes * 60 * 1000);
  cleanupTimer.unref();

  server = app.listen(config.port, config.host, () => {
    logger.info('Server started', {
      url: `http://${config.host}:${config.port}`,
      adminUsername: config.adminUsername,
      proxyMode: config.workspaceProxyMode,
    });
  });

  server.on('upgrade', (req, socket, head) => {
    handleUpgrade(req, socket, head).catch((error) => {
      logger.error('Unhandled websocket upgrade failure', { error: error.message });
      socket.destroy();
    });
  });
}

process.on('SIGINT', () => {
  shutdown('SIGINT').catch((error) => {
    logger.error('Graceful shutdown failed', { error: error.message });
    process.exit(1);
  });
});

process.on('SIGTERM', () => {
  shutdown('SIGTERM').catch((error) => {
    logger.error('Graceful shutdown failed', { error: error.message });
    process.exit(1);
  });
});

start().catch((error) => {
  logger.error('Startup failed', { error: error.message });
  process.exit(1);
});
