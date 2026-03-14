const DEFAULT_SESSION_SECRET = 'change-me-in-production';
const DEFAULT_ADMIN_PASSWORD = 'changeme123';

function readInt(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === '') {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${name} must be an integer.`);
  }

  return parsed;
}

function readBoolean(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined || value === '') {
    return fallback;
  }

  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`Environment variable ${name} must be "true" or "false".`);
}

function readString(name, fallback = '') {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function readList(name) {
  const value = process.env[name];
  if (value === undefined || value === '') {
    return [];
  }

  return [...new Set(
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
  )];
}

function looksLikePlaceholder(value) {
  return /(replace|changeme|example)/i.test(String(value || ''));
}

function isValidOrigin(origin) {
  try {
    const parsed = new URL(origin);
    return ['http:', 'https:'].includes(parsed.protocol) && parsed.origin === origin;
  } catch (error) {
    return false;
  }
}

const port = readInt('PORT', 3000);
const configuredWorkspaceTrustedOrigins = readList('WORKSPACE_TRUSTED_ORIGINS');
const defaultWorkspaceTrustedOrigins = [
  `http://localhost:${port}`,
  `http://127.0.0.1:${port}`,
];

const config = {
  appName: 'CodeSpace Manager',
  nodeEnv: readString('NODE_ENV', 'development'),
  port,
  host: readString('HOST', '0.0.0.0'),
  trustProxy: readString('TRUST_PROXY', 'loopback'),
  cookieSecure: readBoolean('COOKIE_SECURE', false),
  sessionSecret: readString('SESSION_SECRET', DEFAULT_SESSION_SECRET),
  sessionCookieName: readString('SESSION_COOKIE_NAME', 'csm.sid'),
  sessionMaxAgeMs: readInt('SESSION_MAX_AGE_HOURS', 24) * 60 * 60 * 1000,
  adminUsername: readString('ADMIN_USERNAME', 'admin').trim().toLowerCase(),
  adminPassword: readString('ADMIN_PASSWORD', DEFAULT_ADMIN_PASSWORD),
  databaseUrl: readString('DATABASE_URL', ''),
  databaseSsl: readBoolean('POSTGRES_SSL', false),
  databaseSslRejectUnauthorized: readBoolean('POSTGRES_SSL_REJECT_UNAUTHORIZED', true),
  postgresHost: readString('POSTGRES_HOST', '127.0.0.1'),
  postgresPort: readInt('POSTGRES_PORT', 5432),
  postgresUser: readString('POSTGRES_USER', 'postgres'),
  postgresPassword: readString('POSTGRES_PASSWORD', 'postgres'),
  postgresDatabase: readString('POSTGRES_DB', 'postgres'),
  dockerSocket: readString('DOCKER_SOCKET', '/var/run/docker.sock'),
  dockerNetworkName: readString('DOCKER_NETWORK_NAME', 'csm-network'),
  workspaceProxyMode: readString('WORKSPACE_PROXY_MODE', 'host'),
  workspaceStorageMode: readString('WORKSPACE_STORAGE_MODE', 'named-volume'),
  workspaceBasePath: readString('WORKSPACE_BASE_PATH', '/workspaces'),
  workspaceTrustedOriginsConfigured: configuredWorkspaceTrustedOrigins.length > 0,
  workspaceTrustedOrigins: configuredWorkspaceTrustedOrigins.length > 0
    ? configuredWorkspaceTrustedOrigins
    : defaultWorkspaceTrustedOrigins,
  codeServerImage: readString('CODE_SERVER_IMAGE', 'codercom/code-server:latest'),
  defaultCpuShares: readInt('DEFAULT_CPU_SHARES', 1024),
  defaultMemoryMb: readInt('DEFAULT_MEMORY_MB', 1024),
  portRangeStart: readInt('PORT_RANGE_START', 10000),
  portRangeEnd: readInt('PORT_RANGE_END', 10999),
  idleTimeoutMinutes: readInt('IDLE_TIMEOUT_MINUTES', 60),
  cleanupIntervalMinutes: readInt('CLEANUP_INTERVAL_MINUTES', 10),
  codeServerBootTimeoutMs: readInt('CODE_SERVER_BOOT_TIMEOUT_MS', 45000),
  logLevel: readString('LOG_LEVEL', 'info'),
  skipDockerPing: readBoolean('SKIP_DOCKER_PING', false),
};

function validateConfig() {
  const errors = [];
  const warnings = [];

  if (!config.adminUsername) {
    errors.push('ADMIN_USERNAME cannot be empty.');
  }

  if (config.portRangeStart > config.portRangeEnd) {
    errors.push('PORT_RANGE_START must be less than or equal to PORT_RANGE_END.');
  }

  if (!['host', 'network'].includes(config.workspaceProxyMode)) {
    errors.push('WORKSPACE_PROXY_MODE must be "host" or "network".');
  }

  if (!['named-volume', 'bind'].includes(config.workspaceStorageMode)) {
    errors.push('WORKSPACE_STORAGE_MODE must be "named-volume" or "bind".');
  }

  if (config.workspaceTrustedOrigins.length === 0) {
    errors.push('WORKSPACE_TRUSTED_ORIGINS must include at least one origin.');
  }

  for (const origin of config.workspaceTrustedOrigins) {
    if (!isValidOrigin(origin)) {
      errors.push(`WORKSPACE_TRUSTED_ORIGINS contains an invalid origin: ${origin}`);
    }
  }

  if (config.nodeEnv === 'production') {
    if (
      config.sessionSecret === DEFAULT_SESSION_SECRET ||
      config.sessionSecret.length < 32 ||
      looksLikePlaceholder(config.sessionSecret)
    ) {
      errors.push('SESSION_SECRET must be at least 32 characters in production.');
    }

    if (
      config.adminPassword === DEFAULT_ADMIN_PASSWORD ||
      config.adminPassword.length < 12 ||
      looksLikePlaceholder(config.adminPassword)
    ) {
      errors.push('ADMIN_PASSWORD must be changed to a strong password in production.');
    }

    if (!config.workspaceTrustedOriginsConfigured) {
      warnings.push('WORKSPACE_TRUSTED_ORIGINS is not set. Only localhost origins are trusted for workspace websockets.');
    }
  } else {
    if (config.sessionSecret === DEFAULT_SESSION_SECRET) {
      warnings.push('SESSION_SECRET is using the development fallback.');
    }

    if (config.adminPassword === DEFAULT_ADMIN_PASSWORD) {
      warnings.push('ADMIN_PASSWORD is using the development fallback.');
    }
  }

  if (config.codeServerImage.endsWith(':latest')) {
    warnings.push('CODE_SERVER_IMAGE is using the latest tag. Pin a version before long-lived production deployments.');
  }

  if (errors.length > 0) {
    throw new Error(errors.join(' '));
  }

  return warnings;
}

module.exports = {
  config,
  validateConfig,
};
