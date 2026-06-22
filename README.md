# Orbit Relay

**A 4-agent release pipeline that turns one merge into a finished release — grounded in GitLab Orbit's real lifecycle graph, not just the diff.**

Built for the GitLab Transcend Hackathon (Showcase Track).

---

## The problem

When a merge request lands, four things have to happen before it's actually
*shipped*: someone checks what the change really affects, someone checks
test coverage, someone writes docs, someone decides if this is a patch,
minor, or major release. Each handoff is manual, and each person works from
a smaller slice of context than the last:

- The person checking impact reads the diff, not the call graph.
- The person checking tests doesn't see the impact analysis.
- The person writing docs doesn't know what else in the codebase calls the
  changed function.
- The person cutting the release doesn't know if coverage was actually
  verified.

Context resets at every handoff. GitLab's own Duo Agent Platform already
fixes parts of this *within* a single agent call (the Developer Flow uses
Orbit to find every caller of a renamed method and drafts MRs to fix them
all) — but nothing chains that grounding **across** the stages of a release.

## The fix

Orbit Relay is a 4-stage agent relay — **Code → Test → Docs → Release** —
where each stage reads what the previous stage learned *and* can query
GitLab Orbit directly for fresh graph context. Nothing is recomputed from
scratch, and nothing is lost between stages the way it is between four
people on a Slack thread.

```
GitLab MR merged
      │ webhook
      ▼
┌─────────────────────┐
│  CLOUD ORCHESTRATOR  │  (this repo, deployable to Vercel)
│  validates webhook   │
│  forwards to mesh    │
└─────────┬────────────┘
          │ tunnel
          ▼
┌─────────────────────────────────────────────┐
│              AGENT RELAY (this repo)          │
│                                                │
│  CODE → TEST → DOCS → RELEASE                 │
│   │       │      │        │                   │
│   └───────┴──────┴────────┘                   │
│   each stage reads the prior stage's findings  │
│   and/or queries Orbit (query_graph) directly  │
│                                                │
│  → posts release notes + semver back to GitLab │
└─────────────────────────────────────────────┘
```

| Stage | What it does | Orbit usage |
|---|---|---|
| **Code** | Maps the real blast radius of every symbol the MR touched | `query_graph` transitive traversal (`REFERENCES`, depth -1) — the canonical "who calls this, even indirectly" query |
| **Test** | Flags downstream callers Orbit found that the MR's test diff doesn't appear to cover | Consumes stage 1's Orbit data — no re-query |
| **Docs** | Writes a "what changed and what it affects" section grounded in real affected files | Consumes stage 1 + 2 |
| **Release** | Aggregates everything, queries what else merged since the last tag, recommends a semver bump | `query_graph` traversal over `MergeRequest`/`IN_PROJECT` since last tag |

## What changes for the developer

Instead of four manual handoffs and four narrower views of the change, one
relay run produces: a grounded impact summary, a concrete coverage-risk
flag (not a vague "add more tests" reminder), accurate change docs, and
release notes with a reasoned semver recommendation — in the time it takes
one MR to merge.

## Architecture: why cloud + local mesh

This repo is deliberately split into two deployable halves:

- **Cloud orchestrator** (`src/cloud/server.js`) — a small Express app
  deployable to Vercel. It validates the GitLab webhook and forwards
  normalized MR data to wherever the real inference happens.
- **Mesh listener** (`src/cloud/meshListener.js`) — runs on local hardware
  (in our case, TitanU Mesh — a local multi-agent system using a
  model-swapped `llama-server` across specialist personas) and does the
  actual model inference + Orbit queries, then returns results back through
  the tunnel.

This split means the public, judge-visible endpoint is always live on
Vercel, while the expensive compute runs on hardware we control. The two
halves talk over a simple bearer-token-authenticated HTTP relay — there's
no dependency between them beyond that one contract, so either half can be
swapped out independently.

**The relay core itself (`src/relay.js` + `src/agents/*`) has zero
dependency on any particular model backend.** It runs out of the box with
a deterministic stub (see `npm test`), and accepts an `invokeModel(persona,
prompt)` callback to plug in any inference backend — TitanU Mesh's
llama-server, the Anthropic API, or anything else.

## Setup

```bash
npm install
npm test          # runs the full 4-stage pipeline against fixture data, no live Orbit access needed
```

### Running against real GitLab Orbit

```bash
export GITLAB_TOKEN=<personal access token with read_api scope>
export GITLAB_FULL_PATH=<your-group/your-project>
node src/relay.js path/to/mr-payload.json
```

See `test/relay.test.js` for the expected MR payload shape.

### Deploying the cloud orchestrator

```bash
export GITLAB_WEBHOOK_SECRET=<shared secret you set in GitLab webhook config>
export MESH_TUNNEL_URL=<public URL of your tunnel into the mesh listener>
export MESH_SHARED_SECRET=<shared secret with the mesh side>
npm run cloud
```

Deploy `src/cloud/server.js` to Vercel (or any Node host) and point a
GitLab project webhook (Merge request events) at
`https://<your-deployment>/webhook/merge`.

### Running the mesh-side listener

```bash
export MESH_SHARED_SECRET=<same secret as above>
export LLAMA_SERVER_URL=http://localhost:8080
export GITLAB_TOKEN=<token>
node src/cloud/meshListener.js
```

Then expose port `8090` via your tunnel of choice and point
`MESH_TUNNEL_URL` at it.

### Installing as a GitLab Duo Agent Skill

```bash
glab skills install --global orbit-relay
```

(Until published to a skill registry, copy `skills/orbit-relay/` into
`~/.agents/skills/orbit-relay/` manually, or install from this repo per
`glab skills install <path-or-url>`.)

## Known limitations / honesty section

- **Orbit MCP wire format**: GitLab's documented MCP integration path is
  registering the endpoint with a client like Claude Code (`claude mcp add
  --transport http`) or `mcp-remote`, which handle the JSON-RPC/MCP
  handshake and OAuth internally. `src/orbit/client.js` implements a
  direct JSON-RPC client against `https://gitlab.com/api/v4/orbit/mcp`
  based on the documented tool names and query DSL, but has not been
  verified against a live Orbit-enabled GitLab.com group at the time of
  writing. If the raw JSON-RPC shape needs adjustment, only
  `src/orbit/client.js`'s `_rpc` method needs to change — every agent and
  test is written against the `OrbitClient` interface, not the wire
  format.
- **Orbit is an Experiment-tier feature** (Premium/Ultimate, feature-flagged
  as of GitLab 18.10) — it requires Orbit enabled on a top-level group you
  own. Demo video shows this against a real Orbit-enabled group.
- **Schema assumptions**: query recipes assume `Symbol`/`REFERENCES` and
  `Project`/`MergeRequest`/`IN_PROJECT` entities exist in your Orbit
  instance's schema. Run `get_graph_schema` first if queries return
  unexpectedly empty.

## License

MIT — see `LICENSE`.
