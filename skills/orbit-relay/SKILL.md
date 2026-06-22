---
name: orbit-relay
description: Runs a 4-stage Code -> Test -> Docs -> Release relay on a merged MR, grounding each stage in GitLab Orbit's lifecycle context graph (query_graph / get_graph_schema) instead of just the diff. Use when a merge request has just been merged and you want grounded release notes, a test-coverage risk assessment, and a semver recommendation in one pass.
---

# Orbit Relay

Orbit Relay turns one merge into a finished release by chaining four
specialist passes, each grounded in GitLab Orbit's real lifecycle graph
rather than the merge request diff alone.

## When to use this skill

Trigger this skill when:
- A merge request has just been merged and the user wants release notes,
  not just a diff summary.
- The user asks "what does this change actually affect" — Orbit Relay's
  first stage answers this with a real blast-radius graph query, not a
  guess from file names.
- The user wants a test-coverage risk flag before cutting a release.

## What it does

1. **Code stage** — calls Orbit's `query_graph` with a transitive
   traversal (`REFERENCES`, direction `in`) for every symbol touched by
   the MR, scoped to the project's `full_path`. This finds every caller,
   not just the files in the diff.
2. **Test stage** — cross-references the blast radius against the MR's
   changed files to flag callers that look untested.
3. **Docs stage** — writes a "what changed and what it affects" section
   grounded in the real affected-file list from stage 1.
4. **Release stage** — calls Orbit again to find what else merged into
   the project since the last tag, then produces release notes and a
   semver recommendation that accounts for the coverage risk from stage 2.

## Query recipes used

Blast radius (stage 1):
```json
{
  "query_type": "traversal",
  "node": {
    "id": "sym",
    "entity": "Symbol",
    "columns": ["name", "file_path"],
    "filters": { "name": { "op": "=", "value": "<TOUCHED_SYMBOL>" } }
  },
  "traverse": {
    "relationship": "REFERENCES",
    "direction": "in",
    "depth": -1,
    "target": { "id": "ref", "entity": "Symbol", "columns": ["name", "file_path"] }
  },
  "filters": { "full_path": { "op": "starts_with", "value": "<PROJECT_FULL_PATH>" } },
  "limit": 200
}
```

Changes since last tag (stage 4):
```json
{
  "query_type": "traversal",
  "node": {
    "id": "p",
    "entity": "Project",
    "columns": ["name", "full_path"],
    "filters": { "full_path": { "op": "=", "value": "<PROJECT_FULL_PATH>" } }
  },
  "traverse": {
    "relationship": "IN_PROJECT",
    "direction": "in",
    "target": {
      "id": "mr",
      "entity": "MergeRequest",
      "columns": ["title", "merged_at", "iid", "author"],
      "filters": { "state": { "op": "=", "value": "merged" } }
    }
  },
  "limit": 100
}
```

## Troubleshooting

- **Empty blast-radius results**: confirm the symbol name matches exactly
  what Orbit indexed — run `get_graph_schema` first to confirm the
  `Symbol` entity and `REFERENCES` relationship exist in your instance's
  schema (schema can vary by Orbit version).
- **401 on query_graph**: re-run `glab auth login`; Orbit MCP auth rides
  on your existing GitLab session.
- **Selectivity validation error**: every query needs a `full_path`
  filter using `starts_with` or `=` — Orbit rejects unscoped queries
  against large instances.

## Repository

Source and standalone runnable version (also usable outside GitLab Duo,
as a webhook-driven pipeline):
https://gitlab.com/REPLACE_WITH_YOUR_NAMESPACE/orbit-relay

MIT licensed.
