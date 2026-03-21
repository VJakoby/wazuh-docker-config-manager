'use strict';

const axios = require('axios');
const https = require('https');

// Wazuh uses a self-signed cert by default in Docker
const client = axios.create({
  httpsAgent: new https.Agent({ rejectUnauthorized: false }),
  timeout: 10_000,
});

let _token = null;
let _tokenExpiry = 0;

function baseURL() {
  return (process.env.WAZUH_API_URL || 'https://localhost:55000').replace(/\/$/, '');
}

function log(level, msg, extra = {}) {
  const ts = new Date().toISOString();
  const extraStr = Object.keys(extra).length ? ' ' + JSON.stringify(extra) : '';
  console[level === 'error' ? 'error' : 'log'](`[wazuh-api] [${ts}] ${msg}${extraStr}`);
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

async function getToken() {
  if (_token && Date.now() < _tokenExpiry) {
    log('info', 'Using cached token');
    return _token;
  }

  const user = process.env.WAZUH_API_USER || 'wazuh';
  const pass = process.env.WAZUH_API_PASS || 'wazuh';
  const url  = `${baseURL()}/security/user/authenticate`;

  log('info', `Authenticating with Wazuh API`, { url, user });

  let res;
  try {
    res = await client.get(url, {
      auth: { username: user, password: pass },
    });
  } catch (err) {
    const status  = err.response?.status;
    const body    = err.response?.data;
    const detail  = body?.detail || body?.message || err.message;

    log('error', `Auth request failed`, { status, detail, url, user });

    if (status === 401) {
      throw new Error(
        `Wazuh API auth failed (401) — wrong username or password.\n` +
        `  URL:  ${url}\n` +
        `  User: ${user}\n` +
        `  Tip:  Check WAZUH_API_USER and WAZUH_API_PASS in your .env\n` +
        `  Wazuh response: ${JSON.stringify(body)}`
      );
    }
    if (status === 404) {
      throw new Error(
        `Wazuh API auth endpoint not found (404).\n` +
        `  URL: ${url}\n` +
        `  Tip: Check WAZUH_API_URL in your .env — is the port correct?`
      );
    }
    throw new Error(`Wazuh API auth error: ${detail} (status ${status ?? 'no response'})`);
  }

  _token = res.data?.data?.token;

  if (!_token) {
    log('error', 'Auth response did not contain a token', { body: res.data });
    throw new Error(
      `Wazuh API returned 200 but no token in response.\n` +
      `  Response body: ${JSON.stringify(res.data)}`
    );
  }

  // Tokens valid 900s by default; refresh at 800s
  _tokenExpiry = Date.now() + 800_000;
  log('info', `Auth successful, token cached for ~800s`, { user });
  return _token;
}

function invalidateToken() {
  log('info', 'Invalidating cached token');
  _token = null;
  _tokenExpiry = 0;
}

async function authHeaders() {
  const token = await getToken();
  return { Authorization: `Bearer ${token}` };
}

// ---------------------------------------------------------------------------
// Generic request helper
// ---------------------------------------------------------------------------

async function request(method, path, data = null, params = {}) {
  const url = `${baseURL()}${path}`;
  log('info', `→ ${method.toUpperCase()} ${url}`, Object.keys(params).length ? { params } : {});

  let headers;
  try {
    headers = await authHeaders();
  } catch (authErr) {
    // Auth itself failed — surface clearly
    throw authErr;
  }

  const doRequest = async (hdrs) => {
    return client.request({ method, url, headers: hdrs, data, params });
  };

  try {
    const res = await doRequest(headers);
    log('info', `← ${res.status} ${method.toUpperCase()} ${path}`);
    return res.data?.data ?? res.data;

  } catch (err) {
    const status = err.response?.status;
    const body   = err.response?.data;
    const detail = body?.detail || body?.message || body?.error || err.message;

    log('error', `← ${status ?? 'ERR'} ${method.toUpperCase()} ${path}`, { detail, body });

    if (status === 401) {
      log('info', 'Got 401 — token may have expired, refreshing and retrying once');
      invalidateToken();
      try {
        const retryHeaders = await authHeaders();
        const res = await doRequest(retryHeaders);
        log('info', `← ${res.status} ${method.toUpperCase()} ${path} (retry)`);
        return res.data?.data ?? res.data;
      } catch (retryErr) {
        const retryStatus = retryErr.response?.status;
        const retryDetail = retryErr.response?.data?.detail || retryErr.message;
        throw new Error(
          `Wazuh API 401 on ${method.toUpperCase()} ${path} even after token refresh.\n` +
          `  Status: ${retryStatus}\n` +
          `  Detail: ${retryDetail}\n` +
          `  Tip: Your user may not have permission for this endpoint. ` +
          `Check the user's role in Wazuh (Administrator role required for most operations).`
        );
      }
    }

    if (status === 403) {
      throw new Error(
        `Wazuh API 403 Forbidden on ${method.toUpperCase()} ${path}.\n` +
        `  Detail: ${detail}\n` +
        `  Tip: The user "${process.env.WAZUH_API_USER || 'wazuh'}" does not have permission ` +
        `for this endpoint. Assign the Administrator role in Wazuh.`
      );
    }

    throw new Error(`Wazuh API ${method.toUpperCase()} ${path}: ${detail} (status ${status ?? 'no response'})`);
  }
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

async function listAgents(params = {}) {
  const defaults = { limit: 500, offset: 0, select: 'id,name,ip,os.name,os.version,os.platform,status,lastKeepAlive,version,group' };
  const data = await request('GET', '/agents', null, { ...defaults, ...params });
  return data?.affected_items ?? [];
}

async function getAgent(agentId) {
  const data = await request('GET', '/agents', null, {
    agents_list: agentId,
    select: 'id,name,ip,os,status,lastKeepAlive,version,group,dateAdd,manager,node_name',
  });
  return data?.affected_items?.[0] ?? null;
}

async function deleteAgents(agentIds) {
  const ids = Array.isArray(agentIds) ? agentIds.join(',') : agentIds;
  return request('DELETE', '/agents', null, {
    agents_list: ids,
    status: 'all',
    older_than: '0s',
  });
}

async function getEnrollmentInfo(agentName, agentIP = 'any', groupName = 'default') {
  const created = await request('POST', '/agents', { name: agentName, ip: agentIP });
  const agentId = created?.id;
  if (!agentId) throw new Error('Failed to create agent entry — no ID returned');

  const keyData = await request('GET', `/agents/${agentId}/key`);
  const key = keyData?.affected_items?.[0]?.key ?? '';

  if (groupName && groupName !== 'default') {
    await assignAgentGroup(agentId, groupName).catch(err => {
      log('error', `Could not assign agent to group "${groupName}"`, { err: err.message });
    });
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

// ---------------------------------------------------------------------------
// Group config (agent.conf)
// ---------------------------------------------------------------------------

async function getGroupConfig(groupName) {
  // The API returns the XML content as a string
  const url = `${baseURL()}/groups/${encodeURIComponent(groupName)}/configuration`;
  log('info', `Fetching group config for "${groupName}"`);

  const headers = await authHeaders();
  try {
    const res = await client.get(url, { headers, params: { raw: true } });
    // raw=true returns the XML directly as text
    return typeof res.data === 'string' ? res.data : JSON.stringify(res.data, null, 2);
  } catch (err) {
    const status = err.response?.status;
    const detail = err.response?.data?.detail || err.message;
    // 400 with "default" can mean empty config — return empty template
    if (status === 400 || status === 404) {
      log('info', `No config found for group "${groupName}", returning template`);
      return defaultAgentConf();
    }
    throw new Error(`Could not fetch group config: ${detail} (status ${status})`);
  }
}

async function updateGroupConfig(groupName, xmlContent) {
  const url = `${baseURL()}/groups/${encodeURIComponent(groupName)}/configuration`;
  log('info', `Updating group config for "${groupName}"`);

  const headers = await authHeaders();
  try {
    await client.put(url, xmlContent, {
      headers: { ...headers, 'Content-Type': 'application/xml' },
    });
  } catch (err) {
    const status = err.response?.status;
    const detail = err.response?.data?.detail || err.message;
    throw new Error(`Could not update group config: ${detail} (status ${status})`);
  }
}

function defaultAgentConf() {
  return `<agent_config>

  <!-- Shared configuration applied to all agents in this group -->

  <!-- File integrity monitoring -->
  <syscheck>
    <frequency>43200</frequency>
    <!-- Add directories to monitor -->
    <!-- <directories>/etc,/usr/bin</directories> -->
  </syscheck>

</agent_config>
`;
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
  getGroupConfig,
  updateGroupConfig,
  getToken,
  invalidateToken,
};
