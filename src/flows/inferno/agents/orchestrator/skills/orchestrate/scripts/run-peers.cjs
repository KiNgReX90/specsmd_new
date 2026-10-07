'use strict';

/**
 * Who made each change since an item's baseline, for verify-item.
 *
 * Every snapshot a dispatch record stores carries the number the tree's sequence gave it, so
 * the records of one tree line up on one timeline: the item's first baseline, every later
 * snapshot of the item and of its peers, then the tree now. Between two neighbouring snapshots a
 * changed path is a peer's when one of the peer's attempts ran across that stretch and claims the
 * path. It is the item's when the item claims it, and nobody's otherwise. A run of nobody's
 * changes that leaves a path on other bytes than it found is flagged. The run is bounded by
 * claimed changes or the ends of the timeline.
 */

const lib = require('./run-lib.cjs');
const dispatch = require('./run-dispatch.cjs');

function seqOf(snapshot) {
  if (!snapshot || !Number.isInteger(snapshot.seq)) {
    throw dispatch.refuse('a dispatch snapshot carries no sequence number: run dispatch-log for its item again, ' +
      'then accept-dispatch the result');
  }
  return snapshot.seq;
}

/**
 * The windows the attempts of a peer lineage ran in. An accepted attempt runs from its baseline
 * to its acceptance and claims what it changed. An attempt nobody accepted runs until the next
 * attempt started, and claims what the attempts after it claim, back to the nearest accepted
 * one. A path an attempt carried is claimed by every attempt before it in the lineage.
 */
function windows(tree, peer) {
  const members = dispatch.lineage(tree, peer);
  const byId = new Map(members.map((member) => [member.dispatchId, member]));
  const next = new Map();
  for (const member of members) for (const id of member.previous || []) next.set(id, member);
  const claims = new Map(members.map((member) => [member, new Set(member.phase === 'accepted' ? dispatch.claimedPaths(member) : [])]));
  for (const member of members.filter((entry) => entry.phase === 'accepted')) {
    const reported = [...dispatch.claimedPaths(member), ...(member.completion.carried || [])];
    const queue = [...(member.previous || [])];
    while (queue.length > 0) {
      const prior = byId.get(queue.shift());
      if (!prior || prior.phase === 'accepted') continue;
      for (const file of reported) claims.get(prior).add(file);
      queue.push(...(prior.previous || []));
    }
  }
  for (const member of members.filter((entry) => entry.phase === 'accepted' && (entry.completion.carried || []).length)) {
    const queue = [...(member.previous || [])];
    const seen = new Set();
    while (queue.length > 0) {
      const prior = byId.get(queue.shift());
      if (!prior || seen.has(prior)) continue;
      seen.add(prior);
      for (const file of member.completion.carried) claims.get(prior).add(file);
      queue.push(...(prior.previous || []));
    }
  }
  return members.map((member) => {
    const end = member.phase === 'accepted' ? member.acceptedSnapshot : (next.get(member.dispatchId) || {}).beforeSnapshot;
    return { peer, member, start: seqOf(member.beforeSnapshot), end: end ? seqOf(end) : Infinity, claims: claims.get(member) };
  });
}

/** A peer's change must lie inside its own ownership and outside this item's. */
function checkPeerChange(tree, run, file, own, editable) {
  const { peer } = run;
  if (!lib.ownedBy(file, peer.assignment.ownership.editable, tree)) {
    throw dispatch.refuse(`dispatch ${peer.dispatchId} for ${dispatch.itemsOf(peer).join(', ')} claims ${file} outside its ` +
      'ownership: review that item first, its verify-item names the file');
  }
  if (own.claimed.includes(file) || lib.ownedBy(file, editable, tree)) {
    throw dispatch.refuse(`dispatch ownership overlaps at ${file} with dispatch ${peer.dispatchId}: ` +
      'a serial chain one builder builds takes one dispatch-log for all its items, with --items a,b');
  }
}

/**
 * The paths that nobody's changes since the item's first baseline leave on other bytes. `now`
 * is the tree as verify-item reads it, and `folded` the paths the fold of the base brought in.
 */
function unexplainedChanges(tree, own, editable, peers, now, folded) {
  const root = seqOf(dispatch.checkSnapshot(own.before));
  const runs = [];
  for (const peer of peers) {
    dispatch.validateDispatch(tree, peer);
    if (!own.ids.has(peer.dispatchId)) runs.push(...windows(tree, peer).filter((run) => run.end > root));
  }
  const snapshots = new Map([[root, own.before]]);
  for (const member of [...own.members, ...runs.map((run) => run.member)]) {
    for (const snapshot of [member.beforeSnapshot, member.acceptedSnapshot]) {
      if (snapshot && seqOf(snapshot) > root) snapshots.set(snapshot.seq, dispatch.checkSnapshot(snapshot));
    }
  }
  const timeline = [...[...snapshots.keys()].sort((left, right) => left - right).map((seq) => snapshots.get(seq)), now];
  const flagged = new Set();
  const stretches = new Map();
  const close = (file) => {
    const stretch = stretches.get(file);
    if (stretch && stretch.found !== stretch.left) flagged.add(file);
    stretches.delete(file);
  };
  for (let index = 1; index < timeline.length; index += 1) {
    const [before, after] = [timeline[index - 1], timeline[index]];
    for (const file of dispatch.snapshotDelta(before, after, true)) {
      const claimed = own.claimed.includes(file);
      if (folded.has(file) && !claimed) continue;
      const run = runs.find((entry) => entry.start <= before.seq && after.seq <= entry.end && entry.claims.has(file));
      if (run) checkPeerChange(tree, run, file, own, editable);
      if (run || claimed) {
        close(file);
        continue;
      }
      const stretch = stretches.get(file) || { found: dispatch.identity(before, file) };
      stretch.left = dispatch.identity(after, file);
      stretches.set(file, stretch);
    }
  }
  for (const file of [...stretches.keys()]) close(file);
  return flagged;
}

module.exports = { unexplainedChanges };
