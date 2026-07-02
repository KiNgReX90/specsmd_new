#!/usr/bin/env python3
"""Restatement ratio per arm (TP-2).

R = (sum over facts of #files-in-arm that state the fact) / (#facts).
R = 1.0 means each fact is written in exactly one file (ideal). Higher = more
restatement. Uses facts/btw.yaml key lists; literal case-insensitive substring match.
"""
import os, re, glob

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.dirname(HERE)
ROOT = os.path.join(BASE, "arms")
FACTS = os.path.join(BASE, "facts", "btw.yaml")

facts = []
cur = None
for line in open(FACTS, encoding="utf-8"):
    m = re.match(r"\s*- id:\s*(\S+)", line)
    if m:
        cur = m.group(1)
        continue
    m = re.match(r"\s*keys:\s*\[(.*)\]", line)
    if m and cur:
        keys = [k.strip().strip('"').strip("'") for k in m.group(1).split(",") if k.strip()]
        facts.append((cur, keys))
        cur = None

arms = sorted(d for d in os.listdir(ROOT) if os.path.isdir(os.path.join(ROOT, d)))
# R = avg files-per-fact (confounded by file count). excess = redundant restatements
# beyond one-each (mentions - facts_present); a true write-once doc has excess ~0
# regardless of how many files it splits into.
print(f"{'arm':<14}{'mdfiles':>8}{'present':>8}{'mentions':>9}{'excess':>7}{'R':>7}")
print("-" * 53)
for arm in arms:
    files = glob.glob(os.path.join(ROOT, arm, "**", "*.md"), recursive=True)
    texts = [open(f, encoding="utf-8", errors="ignore").read().lower() for f in files]
    total = 0
    present = 0
    for _fid, keys in facts:
        klc = [k.lower() for k in keys]
        cnt = sum(1 for t in texts if any(k in t for k in klc))
        total += cnt
        present += 1 if cnt else 0
    R = total / len(facts) if facts else 0
    excess = total - present
    print(f"{arm:<14}{len(files):>8}{present:>8}{total:>9}{excess:>7}{R:>7.2f}")
