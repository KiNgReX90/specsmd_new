/**
 * Fixture test for the inception-import converter's mechanical core.
 *
 * Locks two seams of the inception→INFERNO bridge:
 *
 *  1. The DETERMINISTIC extraction core
 *     (`flows/inferno/.../inception-import/scripts/extract-memory-bank-intent.cjs`)
 *     correctly turns a hand-authored memory-bank intent into a structured
 *     model — story ids/units/AC/edges captured, units listed, and the
 *     discarded artifacts (unit-brief, bolts) absent.
 *
 *  2. Applying SKILL.md's documented model→work-item mapping rules to that
 *     model yields work-item skeletons that PASS the orchestrator's real
 *     `team-scheduler.cjs` `validateWorkItem` contract — with story prose
 *     LINKED (never copied) and the unresolvable story FLAGGED and SKIPPED.
 *
 * Scope boundary (see the work-item spec): the model→work-item RENDERING is
 * agent reasoning living in SKILL.md, not a code path. So the skeleton builder
 * here is the TEST applying those rules — it is intentionally NOT imported from
 * the skill dir, and no mapper is added there. The two imported modules
 * (extraction core + validator) are the real, shipped ones — never reimplemented.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import path from 'path';

const require = createRequire(import.meta.url);

// __dirname === src/__tests__/unit/inferno
const SRC_ROOT = path.resolve(__dirname, '../../..');

const {
  extractMemoryBankIntent,
} = require(
  path.join(
    SRC_ROOT,
    'flows/inferno/agents/planner/skills/inception-import/scripts/extract-memory-bank-intent.cjs',
  ),
);

const {
  validateWorkItem,
} = require(
  path.join(
    SRC_ROOT,
    'flows/inferno/agents/orchestrator/skills/orchestrate/scripts/team-scheduler.cjs',
  ),
);

const INTENT_DIR = path.resolve(
  __dirname,
  '../../fixtures/inception-import/001-sample-intent',
);

// ---------------------------------------------------------------------------
// SKILL.md model→work-item mapping, applied in-test (planner reasoning, no code
// path in the skill dir). Mirrors <the_mapping> / <the_contract> in SKILL.md:
//   story id/title  → work-item id/title
//   story file      → context.required (LINKED, never copied)
//   story AC        → work-item Acceptance Criteria (verbatim)
//   story edges     → depends_on (filtered to emitted ids)
//   unit            → ownership.editable partition + grouping label
//   bolts           → discarded (never present in the model)
//   kind/complexity → inferred
// A story whose unit has no resolvable ownership partition is unresolvable: the
// builder returns null so the caller can FLAG and SKIP it (never emit invalid).
// ---------------------------------------------------------------------------

/** Unit → concrete editable ownership partition (resolved against the tree). */
const UNIT_OWNERSHIP: Record<string, string[]> = {
  '001-parser-unit': ['src/parser/'],
  '002-ui-unit': ['src/ui/tree/'],
  // 003-orphan-unit deliberately absent → unresolvable target.
};

/** Unit → pattern + test anchors (resolved from the unit's tech context). */
const UNIT_PATTERNS: Record<string, string[]> = {
  '001-parser-unit': ['src/parser/lexer.ts'],
  '002-ui-unit': ['src/ui/tree/node.tsx'],
};
const UNIT_TESTS: Record<string, string[]> = {
  '001-parser-unit': ['src/parser/__tests__/parser.test.ts'],
  '002-ui-unit': ['src/ui/tree/__tests__/tree.test.ts'],
};

/** Infer kind from the unit/AC scope (SKILL.md step 3 substep). */
function inferKind(story: any): string {
  return story.unit.includes('ui') ? 'ui' : 'behavior';
}

/** Infer complexity from acceptance-criteria breadth. */
function inferComplexity(story: any): string {
  return story.acceptance_criteria.length >= 3 ? 'high' : 'medium';
}

/**
 * Build a work-item skeleton from a story by SKILL.md's rules.
 * Returns null when the story is unresolvable (no ownership partition).
 */
function buildWorkItemSkeleton(story: any, emittedIds: Set<string>): any | null {
  const editable = UNIT_OWNERSHIP[story.unit];
  if (!editable) {
    return null; // unresolvable → caller flags + skips
  }

  const kind = inferKind(story);

  return {
    id: story.id,
    title: story.title,
    kind,
    complexity: inferComplexity(story),
    // depends_on: only edges that resolve to an emitted work item.
    depends_on: story.depends_on.filter((d: string) => emittedIds.has(d)),
    // Acceptance criteria carried verbatim from the model.
    acceptance_criteria: story.acceptance_criteria,
    // Description is a POINTER, not a re-summary of story.body.
    description: `Implement the ${story.title} story; see the linked story file for the full narrative.`,
    context: {
      // Story file LINKED, never copied. source_path is the link target.
      required: [
        {
          path: `memory-bank/intents/${path.basename(INTENT_DIR)}/${story.source_path}`,
          reason: 'source story: full narrative + acceptance criteria',
        },
      ],
      patterns: (UNIT_PATTERNS[story.unit] || []).map((p) => ({
        path: p,
        reason: 'sibling that models the convention',
      })),
      tests: (UNIT_TESTS[story.unit] || []).map((p) => ({
        path: p,
        reason: 'test target for this unit',
      })),
    },
    ownership: {
      editable,
    },
  };
}

/** Run the full SKILL.md mapping, returning emitted skeletons + flagged ids. */
function mapModelToWorkItems(model: any): { emitted: any[]; flagged: string[] } {
  // Two-pass so depends_on can be filtered to the set of emitted ids.
  const resolvable = model.stories.filter(
    (s: any) => UNIT_OWNERSHIP[s.unit] !== undefined,
  );
  const emittedIds = new Set<string>(resolvable.map((s: any) => s.id));

  const emitted: any[] = [];
  const flagged: string[] = [];
  for (const story of model.stories) {
    const item = buildWorkItemSkeleton(story, emittedIds);
    if (item === null) {
      flagged.push(story.id);
    } else {
      emitted.push(item);
    }
  }
  return { emitted, flagged };
}

describe('inception-import extraction core', () => {
  const model = extractMemoryBankIntent(INTENT_DIR);

  it('extracts the intent identity and requirements (system-context included)', () => {
    expect(model.intent.id).toBe('001-sample-intent');
    expect(model.intent.slug).toBe('001-sample-intent');
    expect(model.intent.requirements).toContain('Sample Intent');
    expect(model.intent.system_context).toContain('Developer');
  });

  it('lists every unit as an ownership-grouping label', () => {
    expect(model.units).toEqual([
      '001-parser-unit',
      '002-ui-unit',
      '003-orphan-unit',
    ]);
  });

  it('extracts every story with id, unit, and title, in deterministic order', () => {
    expect(model.stories.map((s: any) => s.id)).toEqual([
      '001-extract-stories',
      '002-parse-edges',
      '003-render-tree',
      '004-unresolvable-orphan',
    ]);
    const byId = Object.fromEntries(model.stories.map((s: any) => [s.id, s]));
    expect(byId['001-extract-stories'].unit).toBe('001-parser-unit');
    expect(byId['003-render-tree'].unit).toBe('002-ui-unit');
    expect(byId['003-render-tree'].title).toBe('003-render-tree');
  });

  it('captures acceptance criteria per story (Given/When/Then text, no markdown)', () => {
    const story = model.stories.find((s: any) => s.id === '002-parse-edges');
    expect(story.acceptance_criteria).toHaveLength(2);
    expect(story.acceptance_criteria[0]).toContain('Requires edge');
    // bold markers stripped by the core
    expect(story.acceptance_criteria.join('\n')).not.toContain('**');
  });

  it('normalizes dependency edges to in-intent story ids', () => {
    const byId = Object.fromEntries(model.stories.map((s: any) => [s.id, s]));
    // first story: "None (...)" → no edges
    expect(byId['001-extract-stories'].depends_on).toEqual([]);
    // explicit edge
    expect(byId['002-parse-edges'].depends_on).toEqual(['001-extract-stories']);
    // unit-qualified ref collapses to tail; prose "User navigation" dropped;
    // duplicates de-duped.
    expect(byId['003-render-tree'].depends_on).toEqual([
      '002-parse-edges',
      '001-extract-stories',
    ]);
  });

  it('links story prose via source_path and never copies the discarded unit-brief or bolts', () => {
    const story = model.stories.find((s: any) => s.id === '001-extract-stories');
    expect(story.source_path).toBe(
      'units/001-parser-unit/stories/001-extract-stories.md',
    );
    // body present (it is what gets LINKED, but it is the story's own prose)
    expect(story.body.length).toBeGreaterThan(0);

    const blob = JSON.stringify(model);
    // discarded unit-brief never read into the model
    expect(blob).not.toContain('UNIT_BRIEF_LEAK_SENTINEL');
    // bolts discarded — the model exposes no bolt field and no bolt artifact
    expect(blob).not.toContain('BOLT_LEAK_SENTINEL');
    expect(model).not.toHaveProperty('bolts');
    expect(model.stories.every((s: any) => !('bolt' in s))).toBe(true);
  });

  it('throws on a directory that is not a completed memory-bank intent', () => {
    expect(() => extractMemoryBankIntent(path.dirname(INTENT_DIR))).toThrow(
      /not a completed memory-bank intent/,
    );
  });
});

describe('inception-import → INFERNO work-item contract', () => {
  const model = extractMemoryBankIntent(INTENT_DIR);
  const { emitted, flagged } = mapModelToWorkItems(model);

  it('emits one work item per resolvable story and flags the unresolvable one', () => {
    expect(emitted.map((w: any) => w.id)).toEqual([
      '001-extract-stories',
      '002-parse-edges',
      '003-render-tree',
    ]);
    expect(flagged).toEqual(['004-unresolvable-orphan']);
  });

  it('every emitted work item PASSES the real team-scheduler validateWorkItem', () => {
    for (const item of emitted) {
      const result = validateWorkItem(item);
      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
    }
  });

  it('ui/behavior items carry context.patterns (the contract requires it)', () => {
    const ui = emitted.find((w: any) => w.id === '003-render-tree');
    expect(ui.kind).toBe('ui');
    expect(ui.context.patterns.length).toBeGreaterThan(0);
    // sanity: dropping patterns makes the real validator reject it
    const stripped = { ...ui, context: { ...ui.context, patterns: [] } };
    expect(validateWorkItem(stripped).valid).toBe(false);
  });

  it('links the story file in context.required and never copies story prose into the item', () => {
    const item = emitted.find((w: any) => w.id === '001-extract-stories');
    const story = model.stories.find((s: any) => s.id === '001-extract-stories');

    // story file is a context.required link, pointing at its source_path
    const required = item.context.required.map((e: any) => e.path);
    expect(required).toContain(
      `memory-bank/intents/001-sample-intent/${story.source_path}`,
    );

    // prose is referenced, not pasted: the item body carries none of the
    // story's distinctive narrative text.
    const itemBlob = JSON.stringify({
      description: item.description,
      acceptance_criteria: item.acceptance_criteria,
    });
    expect(item.description).not.toContain(story.body);
    expect(itemBlob).not.toContain('So that');
    expect(itemBlob).not.toContain('Out of Scope');
  });

  it('carries acceptance criteria verbatim from the extracted model', () => {
    const item = emitted.find((w: any) => w.id === '002-parse-edges');
    const story = model.stories.find((s: any) => s.id === '002-parse-edges');
    expect(item.acceptance_criteria).toEqual(story.acceptance_criteria);
  });

  it('does NOT emit the unresolvable story as an invalid placeholder item', () => {
    expect(emitted.some((w: any) => w.id === '004-unresolvable-orphan')).toBe(
      false,
    );
    // Had it been emitted with no ownership (the failure we are guarding
    // against), the real validator would have rejected it — proving the skip
    // path is what keeps the output contract-valid.
    const wouldBeInvalid = {
      id: '004-unresolvable-orphan',
      kind: 'behavior',
      context: { required: [], patterns: [], tests: [] },
      ownership: { editable: [] },
    };
    expect(validateWorkItem(wouldBeInvalid).valid).toBe(false);
  });
});
