const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const { config } = require('./config');
const logger = require('./logger');

const poolOptions = config.databaseUrl
  ? { connectionString: config.databaseUrl }
  : {
      host: config.postgresHost,
      port: config.postgresPort,
      user: config.postgresUser,
      password: config.postgresPassword,
      database: config.postgresDatabase,
    };

if (config.databaseSsl) {
  poolOptions.ssl = {
    rejectUnauthorized: config.databaseSslRejectUnauthorized,
  };
}

const pool = new Pool(poolOptions);

pool.on('error', (error) => {
  logger.error('Unexpected PostgreSQL client error', { error: error.message });
});

async function query(text, params = []) {
  return pool.query(text, params);
}

async function migrate() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      username VARCHAR(64) NOT NULL UNIQUE,
      password VARCHAR(255) NOT NULL,
      email VARCHAR(255),
      is_admin BOOLEAN NOT NULL DEFAULT FALSE,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      cpu_shares INTEGER NOT NULL DEFAULT 1024 CHECK (cpu_shares > 0),
      memory_mb INTEGER NOT NULL DEFAULT 1024 CHECK (memory_mb > 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      container_id VARCHAR(128),
      container_name VARCHAR(128) NOT NULL UNIQUE,
      port INTEGER UNIQUE,
      status VARCHAR(32) NOT NULL DEFAULT 'provisioning',
      last_active TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS sessions (
      sid VARCHAR NOT NULL PRIMARY KEY,
      sess JSON NOT NULL,
      expire TIMESTAMPTZ NOT NULL
    )
  `);

  await query('CREATE INDEX IF NOT EXISTS sessions_expire_idx ON sessions (expire)');
  await query('CREATE INDEX IF NOT EXISTS workspaces_status_idx ON workspaces (status)');

  await ensureAdminUser();
}

async function ensureAdminUser() {
  const passwordHash = await bcrypt.hash(config.adminPassword, 12);

  await query(
    `
      INSERT INTO users (
        username,
        password,
        email,
        is_admin,
        is_active,
        cpu_shares,
        memory_mb
      )
      VALUES ($1, $2, $3, TRUE, TRUE, $4, $5)
      ON CONFLICT (username)
      DO UPDATE
      SET
        password = EXCLUDED.password,
        is_admin = TRUE,
        is_active = TRUE,
        updated_at = NOW()
    `,
    [
      config.adminUsername,
      passwordHash,
      null,
      config.defaultCpuShares,
      config.defaultMemoryMb,
    ]
  );
}

async function closePool() {
  await pool.end();
}

module.exports = {
  pool,
  query,
  migrate,
  closePool,
};
