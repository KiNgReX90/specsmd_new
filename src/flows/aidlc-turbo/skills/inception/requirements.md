# Skill: Gather Requirements

---

## Progress Display

Show at start of this skill:

```text
### Inception Progress
- [x] Intent created
- [ ] Requirements gathered  ← current
    - [ ] Core clarifying questions (Checkpoint 1a)
    - [ ] Deep-dive interrogation (Checkpoint 1b — mandatory)
- [ ] Artifacts reviewed (Context + Units + Stories + Bolts)
- [ ] Ready for Construction
```

---

## Checkpoints in This Skill

| Checkpoint | Purpose | Wait For |
|------------|---------|----------|
| Checkpoint 1a | Core clarifying questions | User answers |
| Checkpoint 1b | Deep-dive interrogation (edge cases, errors, data, integrations, NFRs) — MANDATORY | User answers |
| Checkpoint 2 | Requirements review | User approval |

---

## Goal

Elicit, analyze, and document functional and non-functional requirements through structured inquiry.

---

## Input

- **Required**: Intent name or path
- **Required**: `.specsmd/aidlc-turbo/memory-bank.yaml` - artifact schema
- **Optional**: Existing `requirements.md` to update

**Note**: Agents load project standards automatically (see `.specsmd/aidlc-turbo/context-config.yaml`). Do not duplicate them in requirements.

---

## Process

### Step 1: Core Clarifying Questions

**Checkpoint 1a**: Present questions before generating anything:

```text
Before I generate requirements, I need to understand:
1. Who are the primary users?
2. What key outcomes matter?
3. Any constraints (regulatory, technical, timeline)?
4. How will we measure success?
5. What concerns you most?
```

**Wait for user response.**

---

### Step 2: Deep-Dive Interrogation (MANDATORY)

**Checkpoint 1b**: The 5 core answers are not enough to write testable requirements. Run a
**mandatory** second interrogation round. Do NOT skip it, and do NOT proceed to requirements
generation (Step 3) until the user has answered — skipping this round is a defect.

Carry the Checkpoint 1a answers in and ask only what they left open:

```text
A few deeper questions before I write requirements — these pin down the edge cases and NFRs:

Edge cases & error handling
1. What are the boundary/edge inputs, and what should happen at each?
2. How should errors and failures surface — to the user, and to operators?

Data shape & storage
3. What are the core entities, their key fields, and where/how are they persisted?

Integrations
4. What external systems, APIs, or services does this touch, and in which direction?

Non-functional probes
5. Performance: any latency/throughput targets or hot paths?
6. Security: authentication, authorization, data sensitivity?
7. Reliability: uptime, failure tolerance, recovery expectations?
```

**Wait for user response.**

The **boundary and integration answers** (what is inside vs. outside the system, external
dependencies, integration contracts) are carried forward as inputs to the
**decisions-and-gates** ledger — recorded there as decisions/caveats/gates, NOT written into
a separate system-context document.

---

### Step 3: Generate Requirements

After **both** question rounds are answered, generate functional and non-functional
requirements, drawing directly on the deep-dive answers.

**Functional Requirements** - derive from:

- Main user flows → Core functionality
- Error cases → Exception handling
- Data storage → Data requirements
- Integrations → External dependencies

**Non-Functional Requirements** - derive from:

- Performance: Response time, throughput
- Scalability: Concurrent users, growth
- Security: Authentication, data sensitivity
- Reliability: Uptime, failure tolerance
- Compliance: Regulatory, audit

**IMPORTANT**: Do NOT duplicate project standards. Only document intent-specific constraints.

### Step 4: Document Requirements

1. **Read Path**: Check `schema.requirements` from `.specsmd/aidlc-turbo/memory-bank.yaml`
   *(Default: `.specs-aidlc-turbo/intents/{intent-name}/requirements.md`)*

2. **Use Template**: `.specsmd/aidlc-turbo/templates/inception/requirements-template.md`

3. **Structure**:

   ```markdown
   ## Functional Requirements
   ### FR-1: {Title}
   - **Description**: {What the system must do}
   - **Acceptance Criteria**: {Measurable conditions}
   - **Priority**: {Must/Should/Could}

   ## Non-Functional Requirements
   ### NFR-1: Performance
   - **Metric**: Response time < 200ms for 95th percentile
   ```

4. **Validate Testability**:
   - ❌ "Fast response" → ✅ "Response < 200ms p95"
   - ❌ "Secure" → ✅ "OAuth 2.0 with MFA"
   - ❌ "Scalable" → ✅ "Support 10K concurrent users"

---

### Step 5: Requirements Review

**Checkpoint 2**: Present FULL requirements for approval.

**CRITICAL: Do NOT summarize. Show complete details for each requirement.**

**Show progress indicator before requirements:**

```text
### Inception Progress
- [x] Intent created
- [ ] Requirements gathered ← current (Checkpoint 2: approval)
- [ ] Artifacts reviewed (Context + Units + Stories + Bolts)
- [ ] Ready for Construction
```

Present exactly as documented:

```text
### Requirements Review

## Functional Requirements

### FR-1: {Title}
- **Description**: {full description}
- **Acceptance Criteria**: {all criteria}
- **Priority**: {Must/Should/Could}

### FR-2: {Title}
- **Description**: {full description}
- **Acceptance Criteria**: {all criteria}
- **Priority**: {Must/Should/Could}

{continue for all FR and NFR...}

---

Do these requirements capture your intent?
1 - Yes, continue to generate artifacts
2 - Need changes (specify what's missing/wrong)
```

**Wait for user response.**

---

## Output

```markdown
## Requirements Summary: {intent-name}

### Functional Requirements

- [ ] **FR-1**: {description} - Priority: Must - Status: Draft
- [ ] **FR-2**: {description} - Priority: Should - Status: Draft

### Non-Functional Requirements

- **Performance**: Response time < 200ms p95
- **Security**: OAuth 2.0 + MFA

### Technical Constraints

Required standards will be loaded from memory-bank standards folder by Construction Agent.

Intent-specific constraints:
- {any feature-specific constraint not in standards}

### Artifact Updated
- `{intent-path}/requirements.md`

### Actions

1 - **decisions-and-gates**: Capture decisions, caveats & release gates (lean — default)
2 - **menu**: Return to inception menu

### Suggested Next Step
→ **decisions-and-gates** - Record load-bearing decisions/caveats/gates for `{intent-name}` (lean). In full mode the next step is **context** instead.

**Type a number or press Enter for suggested action.**
```

---

## After Approval

Once requirements are approved at Checkpoint 2:

1. Save to `{intent}/requirements.md`
2. Proceed to generate the remaining artifacts (auto-continue)

---

## Transition

After requirements approved → auto-continue to generate the batched artifacts:

- **Lean (default):** Decisions-and-Gates → (lean) Units → Stories
- **Full (legacy):** System Context → Units → Stories → Bolt Plan

These will be reviewed together at Checkpoint 3 (Artifacts Review).

---

## Test Contract

```yaml
input: User answers to the 5 core clarifying questions + the mandatory deep-dive round
output: requirements.md with FR-1..n, NFR-1..n
checkpoints: 3
  - Checkpoint 1a: Core clarifying questions answered
  - Checkpoint 1b: Deep-dive interrogation answered (edge cases, errors, data, integrations, NFRs) — mandatory, never skipped
  - Checkpoint 2: Requirements approved
```
