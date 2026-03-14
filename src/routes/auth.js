const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { query } = require('../db');
const logger = require('../logger');
const { config } = require('../config');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
});

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function destroySession(req) {
  return new Promise((resolve, reject) => {
    req.session.destroy((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

router.post('/login', loginLimiter, async (req, res) => {
  const username = normalizeUsername(req.body.username);
  const password = String(req.body.password || '');

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  try {
    const result = await query(
      `
        SELECT id, username, password, is_admin, is_active
        FROM users
        WHERE username = $1
        LIMIT 1
      `,
      [username]
    );

    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    if (!user.is_active) {
      return res.status(403).json({ error: 'This account has been disabled.' });
    }

    const matches = await bcrypt.compare(password, user.password);
    if (!matches) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    await regenerateSession(req);
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.isAdmin = user.is_admin;
    await saveSession(req);

    logger.info('User logged in', { username: user.username, isAdmin: user.is_admin });
    return res.json({
      success: true,
      redirect: user.is_admin ? '/admin' : '/workspace/',
    });
  } catch (error) {
    logger.error('Login failed', { error: error.message, username });
    return res.status(500).json({ error: 'Login failed.' });
  }
});

router.post('/logout', async (req, res) => {
  try {
    const username = req.session?.username;
    await destroySession(req);
    res.clearCookie(config.sessionCookieName);
    logger.info('User logged out', { username });
    return res.json({ success: true });
  } catch (error) {
    logger.error('Logout failed', { error: error.message });
    return res.status(500).json({ error: 'Logout failed.' });
  }
});

router.get('/session', (req, res) => {
  if (!req.session?.userId) {
    return res.json({ authenticated: false });
  }

  return res.json({
    authenticated: true,
    user: {
      id: req.session.userId,
      username: req.session.username,
      isAdmin: req.session.isAdmin,
    },
  });
});

module.exports = router;
