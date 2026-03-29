'use strict';

const fs = require('fs');

function isDockerRuntime() {
  return fs.existsSync('/.dockerenv') || fs.existsSync('/run/.containerenv');
}

function getConfiguredApiURL() {
  return (process.env.WAZUH_API_URL || 'https://localhost:55000').trim();
}

function resolveWazuhApiURL() {
  const raw = getConfiguredApiURL().replace(/\/$/, '');
  const container = (process.env.WAZUH_CONTAINER || '').trim();

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return {
      url: raw,
      raw,
      rewritten: false,
      isDocker: isDockerRuntime(),
      reason: 'invalid-url',
    };
  }

  const isLocalhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  const shouldRewrite = isDockerRuntime() && isLocalhost && !!container;

  if (shouldRewrite) {
    parsed.hostname = container;
  }

  return {
    url: parsed.toString().replace(/\/$/, ''),
    raw,
    rewritten: shouldRewrite,
    isDocker: isDockerRuntime(),
    reason: shouldRewrite ? 'docker-localhost-rewrite' : 'configured',
  };
}

function getWazuhApiURL() {
  return resolveWazuhApiURL().url;
}

module.exports = {
  getConfiguredApiURL,
  getWazuhApiURL,
  isDockerRuntime,
  resolveWazuhApiURL,
};
