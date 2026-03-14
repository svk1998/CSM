const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../db');
const {
  deleteWorkspace,
  getContainerStats,
  getOrCreateWorkspace,
  stopWorkspace,
} = require('../docker');
const { requireAdmin } = require('../middleware/auth');
const logger = require('../logger');
const { config } = require('../config');

const router = express.Router();

router.use(requireAdmin);

function parseOptionalBoolean(value) {
  if (value === undefined) return undefined;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return null;
}

function parseOptionalInteger(value, fieldName) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} must be a positive integer.`);
  }

  return parsed;
}

async function getNonAdminUser(userId) {
  const result = await query(
    `
      SELECT id, username, is_admin
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [userId]
  );

  const user = result.rows[0];
  if (!user || user.is_admin) {
    return null;
  }

  return user;
}

router.get('/summary', async (req, res) => {
  try {
    const result = await query(`
      SELECT
        COUNT(*) FILTER (WHERE is_admin = FALSE) AS total_users,
        COUNT(*) FILTER (WHERE is_admin = FALSE AND is_active = TRUE) AS active_users,
        (SELECT COUNT(*) FROM workspaces WHERE status = 'running') AS running_workspaces,
        (SELECT COUNT(*) FROM workspaces) AS total_workspaces
      FROM users
    `);

    return res.json(result.rows[0]);
  } catch (error) {
    logger.error('Failed to load dashboard summary', { error: error.message });
    return res.status(500).json({ error: 'Failed to load summary.' });
  }
});

router.get('/users', async (req, res) => {
  try {
    const result = await query(`
      SELECT
        u.id,
        u.username,
        u.email,
        u.is_active,
        u.cpu_shares,
        u.memory_mb,
        u.created_at,
        w.status AS workspace_status,
        w.port,
        w.container_id,
        w.container_name,
        w.last_active
      FROM users u
      LEFT JOIN workspaces w ON w.user_id = u.id
      WHERE u.is_admin = FALSE
      ORDER BY u.created_at DESC
    `);

    return res.json(result.rows);
  } catch (error) {
    logger.error('Failed to list users', { error: error.message });
    return res.status(500).json({ error: 'Failed to list users.' });
  }
});

router.post('/users', async (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const email = req.body.email ? String(req.body.email).trim() : null;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  if (!/^[a-z0-9_-]{3,64}$/.test(username)) {
    return res.status(400).json({ error: 'Username must be 3-64 chars using lowercase letters, numbers, underscores, or hyphens.' });
  }

  if (password.length < 10) {
    return res.status(400).json({ error: 'Password must be at least 10 characters.' });
  }

  try {
    const cpuShares = parseOptionalInteger(req.body.cpu_shares, 'cpu_shares') || config.defaultCpuShares;
    const memoryMb = parseOptionalInteger(req.body.memory_mb, 'memory_mb') || config.defaultMemoryMb;
    const passwordHash = await bcrypt.hash(password, 12);

    const result = await query(
      `
        INSERT INTO users (username, password, email, cpu_shares, memory_mb)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, username, email, cpu_shares, memory_mb, created_at
      `,
      [username, passwordHash, email, cpuShares, memoryMb]
    );

    logger.info('User created', { username, by: req.session.username });
    return res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Username already exists.' });
    }

    logger.error('Failed to create user', { error: error.message, username });
    return res.status(500).json({ error: error.message || 'Failed to create user.' });
  }
});

router.patch('/users/:id', async (req, res) => {
  try {
    const user = await getNonAdminUser(req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const updates = [];
    const values = [];
    let parameterIndex = 1;

    if (req.body.password) {
      const password = String(req.body.password);
      if (password.length < 10) {
        return res.status(400).json({ error: 'Password must be at least 10 characters.' });
      }

      updates.push(`password = $${parameterIndex++}`);
      values.push(await bcrypt.hash(password, 12));
    }

    if (req.body.email !== undefined) {
      updates.push(`email = $${parameterIndex++}`);
      values.push(req.body.email ? String(req.body.email).trim() : null);
    }

    if (req.body.is_active !== undefined) {
      const parsed = parseOptionalBoolean(req.body.is_active);
      if (parsed === null) {
        return res.status(400).json({ error: 'is_active must be true or false.' });
      }

      updates.push(`is_active = $${parameterIndex++}`);
      values.push(parsed);
    }

    if (req.body.cpu_shares !== undefined) {
      updates.push(`cpu_shares = $${parameterIndex++}`);
      values.push(parseOptionalInteger(req.body.cpu_shares, 'cpu_shares'));
    }

    if (req.body.memory_mb !== undefined) {
      updates.push(`memory_mb = $${parameterIndex++}`);
      values.push(parseOptionalInteger(req.body.memory_mb, 'memory_mb'));
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Nothing to update.' });
    }

    values.push(req.params.id);

    await query(
      `
        UPDATE users
        SET ${updates.join(', ')}, updated_at = NOW()
        WHERE id = $${parameterIndex}
      `,
      values
    );

    logger.info('User updated', { userId: req.params.id, by: req.session.username });
    return res.json({ success: true });
  } catch (error) {
    logger.error('Failed to update user', { error: error.message, userId: req.params.id });
    return res.status(500).json({ error: error.message || 'Failed to update user.' });
  }
});

router.delete('/users/:id', async (req, res) => {
  try {
    const user = await getNonAdminUser(req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    await deleteWorkspace(req.params.id);
    await query('DELETE FROM users WHERE id = $1', [req.params.id]);
    logger.info('User deleted', { userId: req.params.id, username: user.username, by: req.session.username });
    return res.json({ success: true });
  } catch (error) {
    logger.error('Failed to delete user', { error: error.message, userId: req.params.id });
    return res.status(500).json({ error: 'Failed to delete user.' });
  }
});

router.post('/users/:id/workspace/start', async (req, res) => {
  try {
    const user = await getNonAdminUser(req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const workspace = await getOrCreateWorkspace(req.params.id);
    logger.info('Workspace started by admin', { userId: req.params.id, by: req.session.username });
    return res.json(workspace);
  } catch (error) {
    logger.error('Failed to start workspace', { error: error.message, userId: req.params.id });
    return res.status(500).json({ error: 'Failed to start workspace.' });
  }
});

router.post('/users/:id/workspace/stop', async (req, res) => {
  try {
    const user = await getNonAdminUser(req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    await stopWorkspace(req.params.id);
    logger.info('Workspace stopped by admin', { userId: req.params.id, by: req.session.username });
    return res.json({ success: true });
  } catch (error) {
    logger.error('Failed to stop workspace', { error: error.message, userId: req.params.id });
    return res.status(500).json({ error: 'Failed to stop workspace.' });
  }
});

router.get('/users/:id/stats', async (req, res) => {
  try {
    const result = await query(
      `
        SELECT container_id
        FROM workspaces
        WHERE user_id = $1
        LIMIT 1
      `,
      [req.params.id]
    );

    const workspace = result.rows[0];
    if (!workspace?.container_id) {
      return res.json(null);
    }

    const stats = await getContainerStats(workspace.container_id);
    return res.json(stats);
  } catch (error) {
    logger.warn('Failed to load workspace stats', { error: error.message, userId: req.params.id });
    return res.json(null);
  }
});

module.exports = router;
