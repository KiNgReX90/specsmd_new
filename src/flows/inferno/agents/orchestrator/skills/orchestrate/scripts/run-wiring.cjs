'use strict';

/**
 * The wiring check: a screen or reader that consumes a command, table or event nobody
 * provides is refused at the frontier, before anyone builds it.
 *
 * A work item declares what it adds under `provides:` and what it calls under `consumes:`.
 * A consumed entry counts as wired when an item of the same intent provides it, completed
 * items included, or when the host registry names it. The registry is the `wiring` block of
 * the config: per kind, the file that registers the host's entries, a `within` pattern that
 * cuts the registering block out of it, and a `name` pattern whose last group is one name.
 */

const fs = require('fs');
const path = require('path');

const { RunError } = require('./run-error.cjs');

const KINDS = ['command', 'table', 'event'];

function filled(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/** The `wiring` block, refused with its fix when this script cannot use its shape. */
function validateWiring(config, file) {
  const wiring = config.wiring;
  if (wiring === undefined) return;
  const bad = (what) => new RunError(`${what}. See wiring in config.example.yaml.`, 'BAD_CONFIG');
  if (!wiring || typeof wiring !== 'object' || Array.isArray(wiring)) {
    throw bad(`wiring in ${file} must be a map from a kind to its registry`);
  }
  for (const [kind, entry] of Object.entries(wiring)) {
    if (!KINDS.includes(kind)) throw bad(`wiring.${kind} in ${file}: the kind must be command, table or event`);
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw bad(`wiring.${kind} in ${file} must be a map holding file, within and name`);
    }
    for (const key of ['file', 'within', 'name']) {
      if (!filled(entry[key])) throw bad(`wiring.${kind}.${key} in ${file} must be a non-empty string`);
    }
    for (const key of ['within', 'name']) {
      try {
        new RegExp(entry[key]);
      } catch (error) {
        throw bad(`wiring.${kind}.${key} in ${file} is not a valid regular expression (${error.message}); write it in single quotes`);
      }
    }
  }
}

/** The manifest shape of one `provides:` or `consumes:` block, as contract errors. */
function entryErrors(id, field, entries) {
  if (entries === undefined || entries === null) return [];
  if (!Array.isArray(entries) || entries.length === 0) {
    return [`${id}: ${field} must list at least one entry when the item declares it`];
  }
  const errors = [];
  entries.forEach((entry, index) => {
    const at = `${id}: ${field}[${index}]`;
    const kind = entry && entry.kind;
    if (!KINDS.includes(kind)) errors.push(`${at}.kind must be command, table or event`);
    if (!filled(entry && entry.name)) errors.push(`${at}.name must be a non-empty string`);
    else if (field === 'consumes' && kind !== 'table' && KINDS.includes(kind) && !filled(entry.seam)) {
      errors.push(`${at}.seam must name the test that crosses the bridge for ${kind} ${entry.name}`);
    }
  });
  return errors;
}

/** The names a host registry file registers, or a refusal naming the missing file. */
function registered(tree, kind, entry) {
  const file = path.join(tree, entry.file);
  if (!fs.existsSync(file)) {
    return { error: `wiring.${kind}.file ${entry.file} does not exist in ${tree}; point it at the file that registers every ${kind}` };
  }
  const text = fs.readFileSync(file, 'utf8');
  const names = new Set();
  for (const block of text.matchAll(new RegExp(entry.within, 'g'))) {
    const body = block.length > 1 ? block[block.length - 1] || '' : block[0];
    for (const hit of body.matchAll(new RegExp(entry.name, 'g'))) {
      const name = hit.length > 1 ? hit[hit.length - 1] : hit[0];
      if (name) names.add(name);
    }
  }
  return { names };
}

/**
 * Every consumes entry of the open items that no item of the intent provides and the host
 * does not register. `all` holds the manifests of every item of the intent, completed ones too.
 */
function wiringErrors(tree, intentId, open, all, config) {
  const key = (kind, name) => `${kind} ${name}`;
  const provided = new Set();
  for (const item of all) {
    for (const entry of Array.isArray(item.provides) ? item.provides : []) {
      if (entry && entry.kind && entry.name) provided.add(key(entry.kind, entry.name));
    }
  }
  const wiring = (config && config.wiring) || {};
  const registries = {};
  const errors = [];
  for (const item of open) {
    for (const entry of Array.isArray(item.consumes) ? item.consumes : []) {
      if (!entry || !entry.kind || !entry.name || provided.has(key(entry.kind, entry.name))) continue;
      const registry = wiring[entry.kind];
      if (registry && !registries[entry.kind]) registries[entry.kind] = registered(tree, entry.kind, registry);
      const read = registries[entry.kind];
      if (read && read.error) {
        if (!errors.includes(read.error)) errors.push(read.error);
        continue;
      }
      if (read && read.names.has(entry.name)) continue;
      const host = registry
        ? `${registry.file} does not register it. Add it to the provides of the item that builds it, or register it in that file`
        : `no wiring.${entry.kind} file is configured to register it. Add it to the provides of the item that builds it, ` +
          `or name the registering file under wiring.${entry.kind} in the config`;
      errors.push(`${item.id}: consumes ${key(entry.kind, entry.name)}: no item in ${intentId} provides it and ${host}`);
    }
  }
  return errors;
}

module.exports = { KINDS, entryErrors, validateWiring, wiringErrors };
