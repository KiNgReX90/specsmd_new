'use strict';

/**
 * Which of an item's changed paths other dispatches explain, for verify-item.
 *
 * Every accepted attempt is one step per path it changed, from the bytes it started on to the
 * bytes it left. A path an attempt carried steps back to the attempt before it. A path is
 * explained when such steps lead from what it holds now back to the item's baseline. Only a
 * step that started at or after that baseline counts. A step never jumps from a lineage's latest
 * bytes to its first baseline, so bytes that changed between two attempts are nobody's. A step
 * never ends on bytes another step later built on, so a rolled back patch never explains the
 * same bytes coming back.
 */

const lib = require('./run-lib.cjs');
const dispatch = require('./run-dispatch.cjs');

/** Whether a baseline at `head` started at or after one at `ancestor`: the same commit or a later one. */
function startsFrom(tree, ancestor, head) {
  return ancestor === head || lib.git(tree, ['merge-base', '--is-ancestor', ancestor, head], { tolerate: true }) !== null;
}

const claimsOf = (attempt) => [...dispatch.claimedPaths(attempt), ...(attempt.completion.carried || [])];

/**
 * The steps one lineage took. A carried path steps from the attempt that carried it back to the
 * attempt before, and on through attempts that did not claim it. It never steps across bytes that
 * changed after an accepted attempt and before the next one started.
 */
function lineageSteps(tree, record) {
  const members = dispatch.lineage(tree, record);
  const byId = new Map(members.map((member) => [member.dispatchId, member]));
  const steps = [];
  const seen = new Set();
  const carry = (attempt, file) => {
    for (const prior of (attempt.previous || []).map((id) => byId.get(id)).filter(Boolean)) {
      const key = JSON.stringify([prior.dispatchId, attempt.dispatchId, file]);
      if (seen.has(key)) continue;
      seen.add(key);
      if (prior.phase === 'accepted' && (claimsOf(prior).includes(file) ||
          !dispatch.same(prior.acceptedSnapshot, attempt.beforeSnapshot, file))) continue;
      steps.push({ file, from: prior.beforeSnapshot, to: attempt.beforeSnapshot });
      carry(prior, file);
    }
  };
  for (const attempt of members.filter((member) => member.phase === 'accepted')) {
    for (const file of dispatch.claimedPaths(attempt)) steps.push({ file, from: attempt.beforeSnapshot, to: attempt.acceptedSnapshot });
    for (const file of attempt.completion.carried || []) carry(attempt, file);
  }
  return steps.filter((step) => !dispatch.same(step.from, step.to, step.file));
}

/**
 * Whether the steps lead from `now` back to `baseline`, newest step first. Another step that
 * started on the bytes a step left must be the one taken just before it in the walk, or one
 * taken after it, which came earlier. Any other means those bytes were built on and are back.
 */
function leadsBack(steps, now, baseline) {
  const valid = (walk) => walk.every((step, k) => steps.every((other) =>
    other === step || other.start !== step.end || other === walk[k - 1] || walk.indexOf(other) > k));
  const search = (state, walk) => (walk.length > 0 && state === baseline && valid(walk)) ||
    steps.some((step) => !walk.includes(step) && step.end === state && search(step.start, [...walk, step]));
  return search(now, []);
}

/**
 * The changed paths the peers' accepted attempts explain. A peer step on a path this item claims
 * or owns is an overlap, and a peer step on a path its own ownership does not cover is refused.
 */
function explainedByPeers(tree, own, editable, peers, current) {
  const identity = (snapshot, file) => dispatch.hash(dispatch.entryIn(snapshot, file));
  const starts = new Map();
  const startsHere = (head) => {
    if (!starts.has(head)) starts.set(head, startsFrom(tree, own.before.head_sha, head));
    return starts.get(head);
  };
  const steps = [];
  for (const peer of peers) {
    dispatch.validateDispatch(tree, peer);
    if (own.ids.has(peer.dispatchId)) continue;
    for (const step of lineageSteps(tree, peer)) {
      const { file } = step;
      if (!current.changed.includes(file) || !startsHere(step.from.head_sha)) continue;
      if (!lib.ownedBy(file, peer.assignment.ownership.editable, tree)) throw dispatch.refuse('peer dispatch claims an unowned path');
      const end = identity(step.to, file);
      if (end !== identity(own.before, file) && (own.claimed.includes(file) || lib.ownedBy(file, editable, tree))) {
        throw dispatch.refuse(`dispatch ownership overlaps at ${file} with dispatch ${peer.dispatchId}: ` +
          'a serial chain one builder builds takes one dispatch-log --items a,b');
      }
      steps.push({ file, start: identity(step.from, file), end });
    }
  }
  return new Set(current.changed.filter((file) => leadsBack(steps.filter((step) => step.file === file),
    identity(current.snapshot, file), identity(own.before, file))));
}

module.exports = { explainedByPeers, startsFrom };
