'use strict';

const axios = require('axios');
const https = require('https');

// Wazuh uses a self-signed cert by default in Docker — disable verification
// for local use. In production you'd swap this for a proper cert.
const client = axios.create({
  httpsAgent: new https.Agent({ rejectUnauthorized: false }),
  timeout: 10_000,
});

let _token = null;
let _tokenExpiry = 0;

function baseURL() {
  return (process.env.WAZUH_API_URL || 'https://localhost:55000').replace(/\/$/, '');
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

async function getToken() {
  if (_token && Date.now() < _tokenExpiry) return _token;

  const user = process.env.WAZUH_API_USER || 'wazuh';
  const pass = process.env.WAZUH_API_PASS || 'wazuh';

  const res = await client.get(`${baseURL()}/security/user/authenticate`, {
    auth: { username: user, password: pass },
  });

  _token = res.data?.data?.token;
  if (!_token) throw new Error('Wazuh API authentication failed — check WAZUH_API_USER / WAZUH_API_PASS');

  // Tokens are valid for 900s by default; refresh at 800s
  _tokenExpiry = Date.now() + 800_000;
  return _token;
}

function invalidateToken() {
  _token = null;
  _tokenExpiry = 0;
}

async function authHeaders() {
  const token = await getToken();
  return { Authorization: `Bearer ${token}` };
}

// ---------------------------------------------------------------------------
// Generic request helper with auto-retry on 401
// ---------------------------------------------------------------------------

async function request(method, path, data = null, params = {}) {
  const url = `${baseURL()}${path}`;
  const headers = await authHeaders();

  try {
    const res = await client.request({ method, url, headers, data, params });
    return res.data?.data ?? res.data;
  } catch (err) {
    if (err.response?.status === 401) {
      // Token expired — refresh and retry once
      invalidateToken();
      const retryHeaders = await authHeaders();
      const res = await client.request({ method, url, headers: retryHeaders, data, params });
      return res.data?.data ?? res.data;
    }
    const msg = err.response?.data?.detail || err.response?.data?.message || err.message;
    throw new Error(`Wazuh API ${method.toUpperCase()} ${path}: ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

/**
 * List all agents.
 * Returns array of agent objects.
 */
async function listAgents(params = {}) {
  const defaults = { limit: 500, offset: 0, select: 'id,name,ip,os,status,lastKeepAlive,version,group' };
  const data = await request('GET', '/agents', null, { ...defaults, ...params });
  return data?.affected_items ?? [];
}

/**
 * Get a single agent by ID.
 */
async function getAgent(agentId) {
  const data = await request('GET', `/agents`, null, {
    agents_list: agentId,
    select: 'id,name,ip,os,status,lastKeepAlive,version,group,dateAdd,manager,node_name',
  });
  return data?.affected_items?.[0] ?? null;
}

/**
 * Delete (remove) one or more agents.
 * agentIds: comma-separated string or array
 */
async function deleteAgents(agentIds) {
  const ids = Array.isArray(agentIds) ? agentIds.join(',') : agentIds;
  return request('DELETE', '/agents', null, {
    agents_list: ids,
    status: 'all',
    older_than: '0s',
  });
}

/**
 * Get the registration key / enrollment command for a new agent.
 * Returns an object with the authd key and OS-specific install commands.
 */
async function getEnrollmentInfo(agentName, agentIP = 'any', groupName = 'default') {
  // Create a new agent entry to get the key
  const created = await request('POST', '/agents', {
    name: agentName,
    ip: agentIP,
  });

  const agentId = created?.id;
  if (!agentId) throw new Error('Failed to create agent entry');

  const keyData = await request('GET', `/agents/${agentId}/key`);
  const key = keyData?.affected_items?.[0]?.key ?? '';

  // Optionally assign to a group
  if (groupName && groupName !== 'default') {
    await assignAgentGroup(agentId, groupName).catch(() => {});
  }

  const managerIP = new URL(baseURL()).hostname;

  return {
    agentId,
    key,
    managerIP,
    commands: buildEnrollCommands(agentName, managerIP, key, groupName),
  };
}

function buildEnrollCommands(agentName, managerIP, key, group) {
  return {
    linux: [
      `# Download and install the Wazuh agent`,
      `curl -so wazuh-agent.deb https://packages.wazuh.com/4.x/apt/pool/main/w/wazuh-agent/wazuh-agent_4.7.3-1_amd64.deb`,
      `sudo WAZUH_MANAGER='${managerIP}' WAZUH_AGENT_NAME='${agentName}' dpkg -i ./wazuh-agent.deb`,
      `sudo systemctl daemon-reload`,
      `sudo systemctl enable wazuh-agent`,
      `sudo systemctl start wazuh-agent`,
    ].join('\n'),
    windows: [
      `# Run in PowerShell as Administrator`,
      `Invoke-WebRequest -Uri https://packages.wazuh.com/4.x/windows/wazuh-agent-4.7.3-1.msi -OutFile wazuh-agent.msi`,
      `msiexec.exe /i wazuh-agent.msi /q WAZUH_MANAGER='${managerIP}' WAZUH_AGENT_NAME='${agentName}'`,
      `NET START WazuhSvc`,
    ].join('\n'),
    macos: [
      `# Download and install`,
      `curl -so wazuh-agent.pkg https://packages.wazuh.com/4.x/macos/wazuh-agent-4.7.3-1.pkg`,
      `sudo launchctl setenv WAZUH_MANAGER '${managerIP}' && sudo launchctl setenv WAZUH_AGENT_NAME '${agentName}'`,
      `sudo installer -pkg ./wazuh-agent.pkg -target /`,
      `sudo /Library/Ossec/bin/wazuh-control start`,
    ].join('\n'),
  };
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

async function listGroups() {
  const data = await request('GET', '/groups', null, { select: 'name,count,configSum' });
  return data?.affected_items ?? [];
}

async function createGroup(name) {
  return request('POST', '/groups', { group_id: name });
}

async function deleteGroup(name) {
  return request('DELETE', '/groups', null, { groups_list: name });
}

async function assignAgentGroup(agentId, groupName) {
  return request('PUT', `/agents/${agentId}/group/${groupName}`);
}

async function removeAgentGroup(agentId, groupName) {
  return request('DELETE', `/agents/${agentId}/group/${groupName}`);
}

// ---------------------------------------------------------------------------
// Manager info
// ---------------------------------------------------------------------------

async function getManagerInfo() {
  return request('GET', '/manager/info');
}

async function getManagerStatus() {
  return request('GET', '/manager/status');
}

module.exports = {
  listAgents,
  getAgent,
  deleteAgents,
  getEnrollmentInfo,
  listGroups,
  createGroup,
  deleteGroup,
  assignAgentGroup,
  removeAgentGroup,
  getManagerInfo,
  getManagerStatus,
  getToken,
  invalidateToken,
};
