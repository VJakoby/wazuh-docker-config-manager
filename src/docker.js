'use strict';

const Docker = require('dockerode');
const tar = require('tar-stream');
const { Readable } = require('stream');

let _docker = null;
let _container = null;

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

function getDocker() {
  if (_docker) return _docker;
  const opts = process.env.DOCKER_HOST
    ? { host: process.env.DOCKER_HOST }
    : { socketPath: '/var/run/docker.sock' };
  _docker = new Docker(opts);
  return _docker;
}

/**
 * Resolve and cache the wazuh-manager container.
 * Accepts an explicit name/ID or auto-discovers by container name.
 */
async function getContainer() {
  if (_container) return _container;

  const docker = getDocker();
  const explicit = process.env.WAZUH_CONTAINER;

  if (explicit) {
    _container = docker.getContainer(explicit);
    // Validate it exists
    await _container.inspect();
    return _container;
  }

  // Auto-discover
  const list = await docker.listContainers();
  const found = list.find(c =>
    c.Names.some(n => n.toLowerCase().includes('wazuh') && n.toLowerCase().includes('manager')) ||
    (c.Image || '').toLowerCase().includes('wazuh-manager')
  );

  if (!found) {
    const names = list.map(c => `${c.Names[0]} (${c.Image})`).join('\n  ');
    throw new Error(
      `Could not find a wazuh-manager container.\n\nRunning containers:\n  ${names}\n\nSet WAZUH_CONTAINER in .env to specify one manually.`
    );
  }

  _container = docker.getContainer(found.Id);
  return _container;
}

/** Reset cached container (useful if the container is restarted) */
function resetContainer() {
  _container = null;
}

// ---------------------------------------------------------------------------
// File operations
// ---------------------------------------------------------------------------

/**
 * Read a file from inside the container.
 * Returns the file contents as a UTF-8 string.
 */
async function readFile(remotePath) {
  const container = await getContainer();

  return new Promise((resolve, reject) => {
    container.getArchive({ path: remotePath }, (err, stream) => {
      if (err) return reject(new Error(`readFile(${remotePath}): ${err.message}`));

      const extract = tar.extract();
      let content = '';

      extract.on('entry', (header, entryStream, next) => {
        const chunks = [];
        entryStream.on('data', d => chunks.push(d));
        entryStream.on('end', () => {
          content = Buffer.concat(chunks).toString('utf8');
          next();
        });
        entryStream.resume();
      });

      extract.on('finish', () => resolve(content));
      extract.on('error', reject);
      stream.pipe(extract);
    });
  });
}

/**
 * Write a string as a file inside the container.
 * The parent directory must already exist.
 */
async function writeFile(remotePath, content) {
  const container = await getContainer();

  const parts = remotePath.split('/');
  const filename = parts.pop();
  const dir = parts.join('/') || '/';

  return new Promise((resolve, reject) => {
    const pack = tar.pack();
    const buf = Buffer.from(content, 'utf8');

    pack.entry({ name: filename, size: buf.length, mode: 0o644 }, buf, err => {
      if (err) return reject(err);
      pack.finalize();
    });

    // Collect the tar into a buffer so we can pass it as a stream
    const chunks = [];
    pack.on('data', d => chunks.push(d));
    pack.on('end', () => {
      const tarBuf = Buffer.concat(chunks);
      const readable = Readable.from(tarBuf);

      container.putArchive(readable, { path: dir }, putErr => {
        if (putErr) return reject(new Error(`writeFile(${remotePath}): ${putErr.message}`));
        resolve();
      });
    });
    pack.on('error', reject);
  });
}

/**
 * List files in a directory inside the container.
 * Returns an array of filenames (not full paths).
 */
async function listDir(remotePath) {
  const output = await exec(['ls', '-1', remotePath]);
  return output
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);
}

/**
 * Delete a file inside the container using rm.
 */
async function deleteFile(remotePath) {
  await exec(['rm', '-f', remotePath]);
}

// ---------------------------------------------------------------------------
// Exec
// ---------------------------------------------------------------------------

/**
 * Run a command inside the container and return stdout+stderr as a string.
 * Optionally pipe stdinData (string) into the process.
 */
async function exec(cmd, stdinData = null) {
  const container = await getContainer();

  const execInstance = await container.exec({
    Cmd: cmd,
    AttachStdout: true,
    AttachStderr: true,
    AttachStdin: !!stdinData,
  });

  return new Promise((resolve, reject) => {
    execInstance.start({ hijack: true, stdin: !!stdinData }, (err, stream) => {
      if (err) return reject(new Error(`exec(${cmd.join(' ')}): ${err.message}`));

      if (stdinData) {
        stream.write(stdinData + '\n');
        stream.end();
      }

      const chunks = [];
      stream.on('data', d => chunks.push(d));
      stream.on('end', () => {
        // Docker multiplexes stdout/stderr — strip the 8-byte frame headers
        const raw = Buffer.concat(chunks);
        resolve(demux(raw));
      });
      stream.on('error', reject);
    });
  });
}

/**
 * Strip Docker stream multiplexing headers (8-byte frames).
 * https://docs.docker.com/engine/api/v1.43/#tag/Container/operation/ContainerAttach
 */
function demux(buf) {
  let output = '';
  let offset = 0;
  while (offset + 8 <= buf.length) {
    const size = buf.readUInt32BE(offset + 4);
    offset += 8;
    if (offset + size <= buf.length) {
      output += buf.slice(offset, offset + size).toString('utf8');
    }
    offset += size;
  }
  return output || buf.toString('utf8');
}

// ---------------------------------------------------------------------------
// Wazuh-specific helpers
// ---------------------------------------------------------------------------

/** Restart the Wazuh manager process inside the container */
async function reloadManager() {
  return exec(['/var/ossec/bin/wazuh-control', 'restart']);
}

/** Run wazuh-logtest with a single log line, return raw output */
async function runLogtest(logLine) {
  return exec(['/var/ossec/bin/wazuh-logtest', '-q'], logLine + '\n\n');
}

/** Return basic info about the discovered container */
async function containerInfo() {
  const container = await getContainer();
  const info = await container.inspect();
  return {
    id: info.Id.slice(0, 12),
    name: info.Name.replace(/^\//, ''),
    status: info.State.Status,
    image: info.Config.Image,
    started: info.State.StartedAt,
  };
}

// ---------------------------------------------------------------------------
// Container management — for the health panel
// ---------------------------------------------------------------------------

/**
 * List all Wazuh-related containers (manager, indexer, dashboard).
 * Returns an array of container info objects.
 */
async function listWazuhContainers() {
  const docker = getDocker();
  const all    = await docker.listContainers({ all: true });

  return all
    .filter(c => c.Names.some(n => n.toLowerCase().includes('wazuh')))
    .map(c => ({
      id:      c.Id.slice(0, 12),
      name:    c.Names[0].replace(/^\//, ''),
      image:   c.Image,
      status:  c.Status,
      state:   c.State,
      started: c.Status,
    }));
}

/**
 * Restart a container by name or ID.
 */
async function restartContainer(nameOrId) {
  const docker    = getDocker();
  const container = docker.getContainer(nameOrId);
  await container.restart({ t: 10 }); // 10s grace period
}

/**
 * Stop a container by name or ID.
 */
async function stopContainer(nameOrId) {
  const docker    = getDocker();
  const container = docker.getContainer(nameOrId);
  await container.stop({ t: 10 });
}

/**
 * Start a container by name or ID.
 */
async function startContainer(nameOrId) {
  const docker    = getDocker();
  const container = docker.getContainer(nameOrId);
  await container.start();
}

module.exports = {
  getContainer,
  resetContainer,
  readFile,
  writeFile,
  listDir,
  deleteFile,
  exec,
  reloadManager,
  runLogtest,
  containerInfo,
  listWazuhContainers,
  restartContainer,
  stopContainer,
  startContainer,
};
