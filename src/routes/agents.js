'use strict';

const express = require('express');
const router = express.Router();
const api = require('../wazuh-api');

// ---------------------------------------------------------------------------
// List agents
// GET /api/agents
// ---------------------------------------------------------------------------

router.get('/', async (req, res) => {
  try {
    const agents = await api.listAgents({}, api.fromSession(req.session));
    res.json({ agents });
  } catch (err) {
    handleError(req, res, err);
  }
});

// ---------------------------------------------------------------------------
// Get single agent
// GET /api/agents/:id
// ---------------------------------------------------------------------------

router.get('/:id', async (req, res) => {
  try {
    const agent = await api.getAgent(req.params.id, api.fromSession(req.session));
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    res.json({ agent });
  } catch (err) {
    handleError(req, res, err);
  }
});

// ---------------------------------------------------------------------------
// Enroll a new agent
// POST /api/agents/enroll   body: { name, ip?, group? }
// ---------------------------------------------------------------------------

router.post('/enroll', async (req, res) => {
  try {
    const { name, ip = 'any', group = 'default' } = req.body;
    if (!name) return res.status(400).json({ error: 'Agent name is required' });

    const info = await api.getEnrollmentInfo(name, ip, group, api.fromSession(req.session));
    res.json(info);
  } catch (err) {
    handleError(req, res, err);
  }
});

// ---------------------------------------------------------------------------
// Delete agent(s)
// DELETE /api/agents/:id
// ---------------------------------------------------------------------------

router.delete('/:id', async (req, res) => {
  try {
    await api.deleteAgents(req.params.id, api.fromSession(req.session));
    res.json({ ok: true });
  } catch (err) {
    handleError(req, res, err);
  }
});

// ---------------------------------------------------------------------------
// Assign agent to group
// PUT /api/agents/:id/group/:group
// ---------------------------------------------------------------------------

router.put('/:id/group/:group', async (req, res) => {
  try {
    await api.assignAgentGroup(req.params.id, req.params.group, api.fromSession(req.session));
    res.json({ ok: true });
  } catch (err) {
    handleError(req, res, err);
  }
});

// ---------------------------------------------------------------------------
// Remove agent from group
// DELETE /api/agents/:id/group/:group
// ---------------------------------------------------------------------------

router.delete('/:id/group/:group', async (req, res) => {
  try {
    await api.removeAgentGroup(req.params.id, req.params.group, api.fromSession(req.session));
    res.json({ ok: true });
  } catch (err) {
    handleError(req, res, err);
  }
});

// ---------------------------------------------------------------------------
// List groups
// GET /api/agents/groups/list
// ---------------------------------------------------------------------------

router.get('/groups/list', async (req, res) => {
  try {
    const groups = await api.listGroups(api.fromSession(req.session));
    res.json({ groups });
  } catch (err) {
    handleError(req, res, err);
  }
});

// ---------------------------------------------------------------------------
// Create group
// POST /api/agents/groups   body: { name }
// ---------------------------------------------------------------------------

router.post('/groups', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Group name is required' });
    await api.createGroup(name, api.fromSession(req.session));
    res.json({ ok: true });
  } catch (err) {
    handleError(req, res, err);
  }
});

// ---------------------------------------------------------------------------
// Delete group
// DELETE /api/agents/groups/:name
// ---------------------------------------------------------------------------

router.delete('/groups/:name', async (req, res) => {
  try {
    await api.deleteGroup(req.params.name, api.fromSession(req.session));
    res.json({ ok: true });
  } catch (err) {
    handleError(req, res, err);
  }
});

// ---------------------------------------------------------------------------
// Get group agent.conf
// GET /api/agents/groups/:name/config
// ---------------------------------------------------------------------------

router.get('/groups/:name/config', async (req, res) => {
  try {
    const content = await api.getGroupConfig(req.params.name, api.fromSession(req.session));
    res.json({ content });
  } catch (err) {
    handleError(req, res, err);
  }
});

// ---------------------------------------------------------------------------
// Update group agent.conf
// PUT /api/agents/groups/:name/config   body: { content }
// ---------------------------------------------------------------------------

router.put('/groups/:name/config', async (req, res) => {
  try {
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'content is required' });
    await api.updateGroupConfig(req.params.name, content, api.fromSession(req.session));
    res.json({ ok: true });
  } catch (err) {
    handleError(req, res, err);
  }
});

function handleError(req, res, err) {
  if (err.code === 'SESSION_EXPIRED') {
    req.session.destroy(() => res.status(401).json({ error: err.message, redirect: '/login' }));
    return;
  }
  res.status(500).json({ error: err.message });
}

module.exports = router;
