const fs = require('fs');
const http = require('http');
const path = require('path');
const Docker = require('dockerode');
const { query } = require('./db');
const { config } = require('./config');
const logger = require('./logger');

const docker = new Docker({
  socketPath: config.dockerSocket,
});

const CODE_SERVER_UID = 1000;
const CODE_SERVER_GID = 1000;
const CODE_SERVER_PROJECT_DIR = '/home/coder/project';
const CODE_SERVER_DATA_DIR = '/home/coder/.local/share/code-server';

function sanitizeUsername(username) {
  return String(username || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
}

function getContainerName(username) {
  return `csm-${sanitizeUsername(username)}`;
}

function getWorkspaceVolumeName(username) {
  return `csm-workspace-${sanitizeUsername(username)}`;
}

function getConfigVolumeName(username) {
  return `csm-config-${sanitizeUsername(username)}`;
}

function getBindProjectPath(username) {
  return path.join(config.workspaceBasePath, sanitizeUsername(username), 'project');
}

function getBindConfigPath(username) {
  return path.join(config.workspaceBasePath, sanitizeUsername(username), 'config');
}

function getWorkspaceTarget(workspace) {
  if (config.workspaceProxyMode === 'network') {
    return `http://${workspace.container_name}:8080`;
  }

  if (!workspace.port) {
    throw new Error(`Workspace ${workspace.container_name} does not have a host port assigned.`);
  }

  return `http://127.0.0.1:${workspace.port}`;
}

function getCodeServerCommand() {
  const trustedOriginArgs = config.workspaceTrustedOrigins.flatMap((origin) => [
    '--trusted-origins',
    origin,
  ]);

  return [
    '--bind-addr',
    '0.0.0.0:8080',
    '--auth',
    'none',
    '--disable-telemetry',
    '--disable-update-check',
    '--abs-proxy-base-path=/workspace',
    ...trustedOriginArgs,
    '/home/coder/project',
  ];
}

function arraysEqual(left = [], right = []) {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

async function pingDocker() {
  await docker.ping();
}

async function getAvailablePort() {
  if (config.workspaceProxyMode !== 'host') {
    return null;
  }

  const result = await query('SELECT port FROM workspaces WHERE port IS NOT NULL');
  const usedPorts = new Set(result.rows.map((row) => row.port));

  for (let port = config.portRangeStart; port <= config.portRangeEnd; port += 1) {
    if (!usedPorts.has(port)) {
      return port;
    }
  }

  throw new Error('No available ports remain in the configured range.');
}

function createWorkspaceBinds(username) {
  if (config.workspaceStorageMode === 'named-volume') {
    return [
      `${getWorkspaceVolumeName(username)}:${CODE_SERVER_PROJECT_DIR}`,
      `${getConfigVolumeName(username)}:${CODE_SERVER_DATA_DIR}`,
    ];
  }

  const projectPath = getBindProjectPath(username);
  const configPath = getBindConfigPath(username);
  fs.mkdirSync(projectPath, { recursive: true });
  fs.mkdirSync(configPath, { recursive: true });

  return [
    `${projectPath}:${CODE_SERVER_PROJECT_DIR}`,
    `${configPath}:${CODE_SERVER_DATA_DIR}`,
  ];
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function ensureImage() {
  try {
    await docker.getImage(config.codeServerImage).inspect();
  } catch (error) {
    logger.info('Pulling code-server image', { image: config.codeServerImage });
    await new Promise((resolve, reject) => {
      docker.pull(config.codeServerImage, (pullError, stream) => {
        if (pullError) {
          reject(pullError);
          return;
        }

        docker.modem.followProgress(stream, (streamError) => {
          if (streamError) reject(streamError);
          else resolve();
        });
      });
    });
  }
}

async function prepareWorkspaceFilesystem(username) {
  const binds = createWorkspaceBinds(username);
  const initContainer = await docker.createContainer({
    Image: config.codeServerImage,
    User: '0:0',
    Entrypoint: ['sh'],
    Cmd: [
      '-lc',
      [
        `mkdir -p ${CODE_SERVER_PROJECT_DIR}`,
        `mkdir -p ${CODE_SERVER_DATA_DIR}`,
        `mkdir -p ${CODE_SERVER_DATA_DIR}/extensions`,
        `mkdir -p ${CODE_SERVER_DATA_DIR}/User`,
        `mkdir -p ${CODE_SERVER_DATA_DIR}/Machine`,
        `mkdir -p ${CODE_SERVER_DATA_DIR}/logs`,
        `chown -R ${CODE_SERVER_UID}:${CODE_SERVER_GID} ${CODE_SERVER_PROJECT_DIR} ${CODE_SERVER_DATA_DIR}`,
      ].join(' && '),
    ],
    HostConfig: {
      Binds: binds,
      NetworkMode: 'none',
    },
  });

  try {
    await initContainer.start();
    const result = await initContainer.wait();
    if (result.StatusCode !== 0) {
      const logs = await initContainer.logs({ stdout: true, stderr: true });
      throw new Error(`Workspace filesystem init failed: ${logs.toString('utf8')}`);
    }
  } finally {
    try {
      await initContainer.remove({ force: true });
    } catch (error) {
      logger.warn('Failed removing workspace init container', {
        error: error.message,
        username,
      });
    }
  }
}

async function removeOrphanedContainerByName(containerName) {
  const containers = await docker.listContainers({
    all: true,
    filters: { name: [containerName] },
  });

  for (const containerInfo of containers) {
    const container = docker.getContainer(containerInfo.Id);
    try {
      if (containerInfo.State === 'running') {
        await container.stop({ t: 5 });
      }
    } catch (error) {
      logger.warn('Failed stopping orphaned container', { error: error.message, containerName });
    }

    try {
      await container.remove({ force: true });
    } catch (error) {
      logger.warn('Failed removing orphaned container', { error: error.message, containerName });
    }
  }
}

function createReadinessRequest(targetUrl) {
  const parsed = new URL(targetUrl);

  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: '/',
        method: 'GET',
        timeout: 3000,
      },
      (response) => {
        response.resume();
        if (!response.statusCode || response.statusCode >= 500) {
          reject(new Error(`Workspace readiness check returned ${response.statusCode || 'unknown status'}.`));
          return;
        }

        resolve();
      }
    );

    request.on('error', reject);
    request.on('timeout', () => request.destroy(new Error('Workspace readiness check timed out.')));
    request.end();
  });
}

async function waitForWorkspaceReady(workspace) {
  const deadline = Date.now() + config.codeServerBootTimeoutMs;
  const target = getWorkspaceTarget(workspace);

  while (Date.now() < deadline) {
    try {
      await createReadinessRequest(target);
      return;
    } catch (error) {
      await delay(1000);
    }
  }

  throw new Error(`Workspace ${workspace.container_name} did not become ready in time.`);
}

async function getWorkspaceRecord(userId) {
  const result = await query(
    `
      SELECT
        w.*,
        u.username,
        u.is_active,
        u.is_admin,
        u.cpu_shares,
        u.memory_mb
      FROM workspaces w
      JOIN users u ON u.id = w.user_id
      WHERE w.user_id = $1
      LIMIT 1
    `,
    [userId]
  );

  return result.rows[0] || null;
}

async function touchWorkspace(userId) {
  await query(
    `
      UPDATE workspaces
      SET last_active = NOW(), updated_at = NOW()
      WHERE user_id = $1
    `,
    [userId]
  );
}

async function createWorkspace(userId) {
  const userResult = await query(
    `
      SELECT id, username, is_active, is_admin, cpu_shares, memory_mb
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [userId]
  );

  const user = userResult.rows[0];
  if (!user) {
    throw new Error('User not found.');
  }

  if (user.is_admin) {
    throw new Error('Admin accounts do not have workspaces.');
  }

  if (!user.is_active) {
    throw new Error('This account is disabled.');
  }

  const containerName = getContainerName(user.username);
  const port = await getAvailablePort();
  await removeOrphanedContainerByName(containerName);
  await ensureImage();
  await prepareWorkspaceFilesystem(user.username);

  const hostConfig = {
    Binds: createWorkspaceBinds(user.username),
    Memory: user.memory_mb * 1024 * 1024,
    MemorySwap: user.memory_mb * 1024 * 1024,
    CpuShares: user.cpu_shares,
    RestartPolicy: { Name: 'unless-stopped' },
    NetworkMode: config.dockerNetworkName,
  };

  if (port) {
    hostConfig.PortBindings = {
      '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: String(port) }],
    };
  }

  logger.info('Creating workspace container', {
    username: user.username,
    containerName,
    port,
    proxyMode: config.workspaceProxyMode,
  });

  const container = await docker.createContainer({
    name: containerName,
    Image: config.codeServerImage,
    Cmd: getCodeServerCommand(),
    Env: ['DOCKER_USER=coder'],
    ExposedPorts: { '8080/tcp': {} },
    HostConfig: hostConfig,
    Labels: {
      'csm.managed': 'true',
      'csm.username': user.username,
      'csm.user_id': String(user.id),
    },
  });

  await container.start();

  const result = await query(
    `
      INSERT INTO workspaces (
        user_id,
        container_id,
        container_name,
        port,
        status,
        last_active,
        updated_at
      )
      VALUES ($1, $2, $3, $4, 'running', NOW(), NOW())
      RETURNING *
    `,
    [user.id, container.id, containerName, port]
  );

  const workspace = result.rows[0];
  await waitForWorkspaceReady(workspace);
  return workspace;
}

function isMissingContainerError(error) {
  return error?.statusCode === 404 || /no such container/i.test(error?.message || '');
}

function isContainerAlreadyStopped(error) {
  return /is not running/i.test(error?.message || '') || /server is not running/i.test(error?.message || '');
}

function workspaceConfigDrifted(containerInfo) {
  if ((containerInfo.Config?.Image || '') !== config.codeServerImage) {
    return true;
  }

  return !arraysEqual(containerInfo.Config?.Cmd || [], getCodeServerCommand());
}

async function ensureRunning(workspace) {
  const container = docker.getContainer(workspace.container_id);
  const containerInfo = await container.inspect();

  if (workspaceConfigDrifted(containerInfo)) {
    logger.info('Workspace container configuration changed, recreating container', {
      containerName: workspace.container_name,
      userId: workspace.user_id,
    });

    try {
      if (containerInfo.State.Running) {
        await container.stop({ t: 10 });
      }
    } catch (error) {
      if (!isContainerAlreadyStopped(error)) {
        throw error;
      }
    }

    try {
      await container.remove({ force: true });
    } catch (error) {
      logger.warn('Failed removing outdated workspace container', {
        error: error.message,
        containerName: workspace.container_name,
      });
    }

    await query('DELETE FROM workspaces WHERE user_id = $1', [workspace.user_id]);
    return createWorkspace(workspace.user_id);
  }

  if (!containerInfo.State.Running) {
    await prepareWorkspaceFilesystem(workspace.username);
    logger.info('Starting stopped workspace', { containerName: workspace.container_name });
    await container.start();
  }

  await query(
    `
      UPDATE workspaces
      SET status = 'running', last_active = NOW(), updated_at = NOW()
      WHERE id = $1
    `,
    [workspace.id]
  );

  const freshWorkspace = await getWorkspaceRecord(workspace.user_id);
  await waitForWorkspaceReady(freshWorkspace);
  return freshWorkspace;
}

async function getOrCreateWorkspace(userId) {
  const existingWorkspace = await getWorkspaceRecord(userId);
  if (!existingWorkspace) {
    return createWorkspace(userId);
  }

  if (existingWorkspace.is_admin) {
    throw new Error('Admin accounts do not have workspaces.');
  }

  if (!existingWorkspace.is_active) {
    throw new Error('This account is disabled.');
  }

  try {
    return await ensureRunning(existingWorkspace);
  } catch (error) {
    if (isMissingContainerError(error)) {
      logger.warn('Workspace container missing, recreating it', {
        userId,
        containerName: existingWorkspace.container_name,
      });
      await query('DELETE FROM workspaces WHERE user_id = $1', [userId]);
      return createWorkspace(userId);
    }

    throw error;
  }
}

async function stopWorkspace(userId) {
  const workspace = await getWorkspaceRecord(userId);
  if (!workspace?.container_id) {
    return;
  }

  const container = docker.getContainer(workspace.container_id);

  try {
    await container.stop({ t: 10 });
  } catch (error) {
    if (!isContainerAlreadyStopped(error)) {
      throw error;
    }
  }

  await query(
    `
      UPDATE workspaces
      SET status = 'stopped', updated_at = NOW()
      WHERE id = $1
    `,
    [workspace.id]
  );

  logger.info('Workspace stopped', { containerName: workspace.container_name, userId });
}

async function removeWorkspaceStorage(username) {
  if (config.workspaceStorageMode === 'named-volume') {
    const volumeNames = [
      getWorkspaceVolumeName(username),
      getConfigVolumeName(username),
    ];

    for (const volumeName of volumeNames) {
      try {
        await docker.getVolume(volumeName).remove();
      } catch (error) {
        logger.warn('Failed removing workspace volume', { error: error.message, volumeName });
      }
    }

    return;
  }

  const projectPath = getBindProjectPath(username);
  const configPath = getBindConfigPath(username);
  fs.rmSync(projectPath, { recursive: true, force: true });
  fs.rmSync(configPath, { recursive: true, force: true });
}

async function deleteWorkspace(userId) {
  const workspace = await getWorkspaceRecord(userId);
  if (!workspace) {
    return;
  }

  if (workspace.container_id) {
    const container = docker.getContainer(workspace.container_id);
    try {
      await container.stop({ t: 5 });
    } catch (error) {
      if (!isContainerAlreadyStopped(error)) {
        logger.warn('Failed stopping workspace during delete', { error: error.message, userId });
      }
    }

    try {
      await container.remove({ force: true });
    } catch (error) {
      logger.warn('Failed removing workspace container', { error: error.message, userId });
    }
  }

  await removeWorkspaceStorage(workspace.username);
  await query('DELETE FROM workspaces WHERE user_id = $1', [userId]);
  logger.info('Workspace deleted', { userId, username: workspace.username });
}

async function getContainerStats(containerId) {
  try {
    const container = docker.getContainer(containerId);
    const stats = await container.stats({ stream: false });

    const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
    const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
    const cpuCount = stats.cpu_stats.online_cpus || stats.cpu_stats.cpu_usage.percpu_usage?.length || 1;
    const cpuPercent = systemDelta > 0 ? (cpuDelta / systemDelta) * cpuCount * 100 : 0;

    const cache = stats.memory_stats.stats?.cache || 0;
    const memUsed = stats.memory_stats.usage - cache;
    const memLimit = stats.memory_stats.limit;
    const memPercent = memLimit > 0 ? (memUsed / memLimit) * 100 : 0;

    return {
      cpu: Math.round(cpuPercent * 10) / 10,
      memUsedMB: Math.round(memUsed / 1024 / 1024),
      memLimitMB: Math.round(memLimit / 1024 / 1024),
      memPercent: Math.round(memPercent * 10) / 10,
    };
  } catch (error) {
    logger.warn('Failed to read container stats', { error: error.message, containerId });
    return null;
  }
}

async function stopIdleWorkspaces(idleMinutes = config.idleTimeoutMinutes) {
  const result = await query(
    `
      SELECT w.user_id, w.container_name, u.username
      FROM workspaces w
      JOIN users u ON u.id = w.user_id
      WHERE w.status = 'running'
      AND w.last_active < NOW() - make_interval(mins => $1)
    `,
    [idleMinutes]
  );

  for (const workspace of result.rows) {
    logger.info('Stopping idle workspace', {
      userId: workspace.user_id,
      username: workspace.username,
      containerName: workspace.container_name,
    });
    await stopWorkspace(workspace.user_id);
  }
}

module.exports = {
  getOrCreateWorkspace,
  getWorkspaceTarget,
  stopWorkspace,
  deleteWorkspace,
  getContainerStats,
  stopIdleWorkspaces,
  touchWorkspace,
  pingDocker,
};
