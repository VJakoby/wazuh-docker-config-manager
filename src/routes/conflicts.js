'use strict';

const express = require('express');
const router  = express.Router();
const docker  = require('../docker');

const CUSTOM_RULES_DIR  = '/var/ossec/etc/rules';
const DEFAULT_RULES_DIR = '/var/ossec/ruleset/rules';

// ---------------------------------------------------------------------------
// Scan all rules and return conflict report
// GET /api/conflicts
// ---------------------------------------------------------------------------

router.get('/', async (req, res) => {
  try {
    const report = await buildConflictReport();
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Scan a single file's IDs against the full ruleset
// POST /api/conflicts/check   body: { content, filename, source }
// ---------------------------------------------------------------------------

router.post('/check', async (req, res) => {
  try {
    const { content, filename, source } = req.body;
    if (!content) return res.status(400).json({ error: 'content is required' });

    // Build the full ID map (excluding the file being checked)
    const report  = await buildConflictReport({ excludeFile: filename, excludeSource: source });
    const ids     = extractRuleIds(content);
    const issues  = [];

    for (const id of ids) {
      // Check conflict with another custom file
      if (report.customMap[id] && report.customMap[id].file !== filename) {
        issues.push({
          id,
          severity: 'conflict',
          message:  `Rule ID ${id} already exists in custom file "${report.customMap[id].file}"`,
          otherFile: report.customMap[id].file,
          otherSource: 'custom',
        });
      }
      // Check override of a default rule
      if (report.defaultMap[id]) {
        issues.push({
          id,
          severity: 'override',
          message:  `Rule ID ${id} overrides default rule in "${report.defaultMap[id].file}"`,
          otherFile: report.defaultMap[id].file,
          otherSource: 'default',
        });
      }
    }

    res.json({ ids, issues });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Core scanner
// ---------------------------------------------------------------------------

async function buildConflictReport(options = {}) {
  const { excludeFile, excludeSource } = options;

  const [customFiles, defaultFiles] = await Promise.all([
    docker.listDir(CUSTOM_RULES_DIR).then(f => f.filter(n => n.endsWith('.xml'))),
    docker.listDir(DEFAULT_RULES_DIR).then(f => f.filter(n => n.endsWith('.xml'))),
  ]);

  // Build ID maps: { ruleId: { file, source } }
  const customMap  = {};
  const defaultMap = {};
  const conflicts  = []; // same ID in two custom files
  const overrides  = []; // custom ID matches a default ID

  // Scan custom rules
  for (const file of customFiles) {
    if (excludeSource === 'custom' && file === excludeFile) continue;
    try {
      const content = await docker.readFile(`${CUSTOM_RULES_DIR}/${file}`);
      const ids     = extractRuleIds(content);
      for (const id of ids) {
        if (customMap[id]) {
          conflicts.push({
            id,
            severity: 'conflict',
            files:    [customMap[id].file, file],
            message:  `Rule ID ${id} defined in both "${customMap[id].file}" and "${file}"`,
          });
        } else {
          customMap[id] = { file, source: 'custom' };
        }
      }
    } catch { /* skip unreadable files */ }
  }

  // Scan default rules
  for (const file of defaultFiles) {
    if (excludeSource === 'default' && file === excludeFile) continue;
    try {
      const content = await docker.readFile(`${DEFAULT_RULES_DIR}/${file}`);
      const ids     = extractRuleIds(content);
      for (const id of ids) {
        defaultMap[id] = { file, source: 'default' };
        // Check if a custom rule overrides this
        if (customMap[id]) {
          overrides.push({
            id,
            severity:    'override',
            customFile:  customMap[id].file,
            defaultFile: file,
            message:     `Custom rule ID ${id} in "${customMap[id].file}" overrides default rule in "${file}"`,
          });
        }
      }
    } catch { /* skip unreadable files */ }
  }

  const totalCustomIds  = Object.keys(customMap).length;
  const totalDefaultIds = Object.keys(defaultMap).length;

  return {
    conflicts,
    overrides,
    customMap,
    defaultMap,
    summary: {
      totalCustomIds,
      totalDefaultIds,
      conflictCount: conflicts.length,
      overrideCount: overrides.length,
      hasIssues:     conflicts.length > 0 || overrides.length > 0,
    },
  };
}

/**
 * Extract all rule IDs from an XML string.
 * Matches <rule id="NNNNN" ...> patterns.
 */
function extractRuleIds(content) {
  const ids = new Set();
  const re  = /<rule\s[^>]*\bid\s*=\s*["'](\d+)["']/gi;
  let m;
  while ((m = re.exec(content)) !== null) {
    ids.add(m[1]);
  }
  return [...ids];
}

module.exports = router;
