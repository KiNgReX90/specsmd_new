const IMPLEMENTATION_KINDS_REQUIRING_PATTERNS = new Set([
  "architecture",
  "api",
  "behavior",
  "ui",
]);

const NON_TESTED_KINDS = new Set(["config", "config-only", "docs", "docs-only"]);

const NOISY_RESULT_KEYS = new Set(["diff", "logs", "reasoning", "file_bodies"]);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function itemId(workItem) {
  return workItem && workItem.id ? workItem.id : "<unknown>";
}

function hasEntries(value) {
  return Array.isArray(value) && value.length > 0;
}
/** The four keys a `reads:` entry carries, each a non-empty string. */
const READS_KEYS = ["path", "source", "when", "stale"];

function isFilledString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * `reads:` is optional and stays optional.
 *
 * An item whose surface draws nothing from the backend omits the field, so an
 * absent block is never an error. A declared block is refused unless every entry
 * says which module holds the read, what it reads, every moment it re-reads, and
 * what the user sees when it never does. That last sentence is what the
 * builder's first failing test asserts is not on screen.
 */
function readsErrors(id, reads) {
  if (reads === undefined || reads === null) {
    return [];
  }

  if (!hasEntries(reads)) {
    return [`${id}: reads must list at least one entry when the item declares it`];
  }

  const errors = [];
  reads.forEach((entry, index) => {
    for (const key of READS_KEYS) {
      if (!isFilledString(entry && entry[key])) {
        errors.push(`${id}: reads[${index}].${key} must be a non-empty string`);
      }
    }
  });
  return errors;
}


function validateWorkItem(workItem) {
  const id = itemId(workItem);
  const context = workItem && workItem.context ? workItem.context : {};
  const ownership = workItem && workItem.ownership ? workItem.ownership : {};
  const kind = String((workItem && (workItem.kind || workItem.type)) || "").toLowerCase();
  const errors = [];

  if (!hasEntries(context.required)) {
    errors.push(`${id}: context.required must contain at least one path`);
  }

  if (!hasEntries(ownership.editable)) {
    errors.push(`${id}: ownership.editable must contain at least one path`);
  }

  if (IMPLEMENTATION_KINDS_REQUIRING_PATTERNS.has(kind) && !hasEntries(context.patterns)) {
    errors.push(`${id}: context.patterns is required for behavior, architecture, ui, or api work`);
  }

  if (!NON_TESTED_KINDS.has(kind) && !hasEntries(context.tests)) {
    errors.push(`${id}: context.tests is required unless the item is docs-only or config-only`);
  }
  errors.push(...readsErrors(id, workItem && workItem.reads));


  return {
    valid: errors.length === 0,
    errors,
  };
}

function ownershipPaths(workItem) {
  return asArray(workItem && workItem.ownership && workItem.ownership.editable);
}

function overlapsAny(paths, claimedPaths) {
  return paths.some((path) => claimedPaths.has(path));
}

function selectDispatchableItems(items, options = {}) {
  const completedIds = options.completedIds || new Set();
  const inFlightItems = asArray(options.inFlightItems);
  const claimedPaths = new Set(inFlightItems.flatMap(ownershipPaths));
  const ready = [];

  for (const workItem of asArray(items)) {
    const id = itemId(workItem);

    if (completedIds.has(id)) {
      continue;
    }

    if (inFlightItems.some((entry) => itemId(entry) === id)) {
      continue;
    }

    const dependencies = asArray(workItem.depends_on);
    if (!dependencies.every((dependency) => completedIds.has(dependency))) {
      continue;
    }

    const paths = ownershipPaths(workItem);
    if (overlapsAny(paths, claimedPaths)) {
      continue;
    }

    ready.push(workItem);
    for (const path of paths) {
      claimedPaths.add(path);
    }
  }

  return ready;
}

function formatContextEntries(entries) {
  return asArray(entries)
    .map((entry) => `- ${entry.path} — ${entry.reason}`)
    .join("\n");
}
/**
 * The declared reads, beside the test context, because each one is a proof the
 * builder owes rather than a note it reads.
 */
function readsSection(reads) {
  if (!hasEntries(reads)) {
    return [];
  }

  return [
    "",
    "What this surface reads:",
    "For each entry, the first failing test moves the source and asserts the surface follows.",
    reads
      .map(
        (entry) =>
          `- ${entry.path}, source ${entry.source}, when ${entry.when}, stale ${entry.stale}`,
      )
      .join("\n"),
  ];
}


function buildBuilderPrompt(workItem) {
  const context = workItem.context || {};
  const ownership = workItem.ownership || {};

  return [
    `Work item: ${workItem.id}`,
    `Title: ${workItem.title || workItem.id}`,
    "",
    "Start from the listed paths. Read file contents yourself; this prompt intentionally carries pointers, not file bodies.",
    "",
    "Required context:",
    formatContextEntries(context.required),
    "",
    "Pattern context:",
    formatContextEntries(context.patterns),
    "",
    "Test context:",
    formatContextEntries(context.tests),
    ...readsSection(workItem.reads),
    "",
    "Editable ownership:",
    asArray(ownership.editable)
      .map((path) => `- ${path}`)
      .join("\n"),
    "",
    "Policy:",
    "- Handle exactly this work item.",
    "- Search autonomously when the manifest is insufficient.",
    "- Stay within editable ownership unless implementation evidence requires a scoped correction.",
    "- Do not commit, edit .specs-inferno/state.yaml, spawn subagents, or choose another work item.",
    "- Return only status, changed_files, tests, context_expansion, and notes.",
  ].join("\n");
}

function validateBuilderResult(result) {
  const id = (result && result.work_item) || "<unknown>";
  const errors = [];

  if (!["ready", "blocked", "halted"].includes(result && result.status)) {
    errors.push(`${id}: status must be "ready", "blocked", or "halted"`);
  }

  if (result && result.status === "halted" && !(typeof result.note === "string" && result.note.trim())) {
    errors.push(`${id}: halted result must carry a note pointing to the halt-note file`);
  }

  if (!Array.isArray(result && result.changed_files)) {
    errors.push(`${id}: changed_files must be an array`);
  }

  if (!(result && typeof result.tests === "string" && result.tests.trim())) {
    errors.push(`${id}: tests must summarize the verification command and result`);
  }

  if (!(result && typeof result.context_expansion === "string" && result.context_expansion.trim())) {
    errors.push(`${id}: context_expansion must be a one-line summary; use "none" when no expansion happened`);
  }

  const keys = Object.keys(result || {});
  if (keys.some((key) => NOISY_RESULT_KEYS.has(key))) {
    errors.push(`${id}: compact result must not include diff, logs, reasoning, or file_bodies`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

module.exports = {
  buildBuilderPrompt,
  selectDispatchableItems,
  validateBuilderResult,
  validateWorkItem,
};
