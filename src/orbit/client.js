/**
 * Orbit MCP Client
 *
 * Thin client for GitLab Orbit's two MCP tools:
 *   - query_graph       (consumes GitLab Credits)
 *   - get_graph_schema  (free)
 *
 * Endpoint: https://gitlab.com/api/v4/orbit/mcp
 * Auth: Bearer token (PAT with `read_api` scope, or OAuth token from `glab auth login`)
 *
 * This client speaks raw MCP-over-HTTP JSON-RPC so it has no dependency on
 * any particular MCP SDK version. See:
 *   https://docs.gitlab.com/orbit/remote/access/mcp/
 */

const DEFAULT_ENDPOINT = 'https://gitlab.com/api/v4/orbit/mcp';

export class OrbitClient {
  /**
   * @param {object} opts
   * @param {string} opts.token - GitLab personal access token or OAuth token
   * @param {string} [opts.endpoint] - Orbit MCP endpoint override
   * @param {string} [opts.fullPath] - default top-level group/project full_path scope
   */
  constructor({ token, endpoint = DEFAULT_ENDPOINT, fullPath } = {}) {
    if (!token) {
      throw new Error('OrbitClient requires a GitLab token (set GITLAB_TOKEN env var)');
    }
    this.token = token;
    this.endpoint = endpoint;
    this.fullPath = fullPath;
    this._requestId = 0;
  }

  async _rpc(method, params) {
    const id = ++this._requestId;
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        params,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Orbit MCP request failed (${res.status}): ${body}`);
    }

    const json = await res.json();
    if (json.error) {
      throw new Error(`Orbit MCP error: ${json.error.message || JSON.stringify(json.error)}`);
    }
    return json.result;
  }

  /** get_graph_schema — free, no credits consumed */
  async getGraphSchema() {
    return this._rpc('tools/call', {
      name: 'get_graph_schema',
      arguments: {},
    });
  }

  /**
   * query_graph — consumes GitLab Credits per call.
   * @param {object} query - Orbit query DSL body (see docs cookbook)
   */
  async queryGraph(query) {
    return this._rpc('tools/call', {
      name: 'query_graph',
      arguments: { query },
    });
  }

  /**
   * Blast-radius query: every entity that imports/calls a given symbol,
   * directly or transitively, scoped to a project full_path.
   *
   * This is the canonical pattern from GitLab's own docs:
   *   "find all files in this project that import AuthService directly
   *    or transitively."
   *
   * @param {string} fullPath - project full_path, e.g. 'my-group/my-project'
   * @param {string} symbol - function/class/module name touched by the MR
   */
  async blastRadius(fullPath, symbol) {
    return this.queryGraph({
      query_type: 'traversal',
      node: {
        id: 'sym',
        entity: 'Symbol',
        columns: ['name', 'file_path'],
        filters: {
          name: { op: '=', value: symbol },
        },
      },
      traverse: {
        relationship: 'REFERENCES',
        direction: 'in',
        depth: -1, // transitive
        target: {
          id: 'ref',
          entity: 'Symbol',
          columns: ['name', 'file_path'],
        },
      },
      filters: {
        full_path: { op: 'starts_with', value: fullPath },
      },
      limit: 200,
    });
  }

  /**
   * Open MRs per project, useful for release-scope aggregation.
   * Mirrors the documented aggregation example.
   */
  async openMergeRequestCounts(groupFullPath, limit = 10) {
    return this.queryGraph({
      query_type: 'aggregation',
      nodes: [
        { id: 'p', entity: 'Project', columns: ['name', 'full_path'] },
        { id: 'mr', entity: 'MergeRequest', filters: { state: { op: '=', value: 'opened' } } },
      ],
      relationships: [{ type: 'IN_PROJECT', from: 'mr', to: 'p' }],
      filters: {
        full_path: { op: 'starts_with', value: groupFullPath },
      },
      group_by: [{ kind: 'node', node: 'p' }],
      aggregations: [{ function: 'count', target: 'mr', alias: 'open_mrs' }],
      aggregation_sort: { column: 'open_mrs', direction: 'DESC' },
      limit,
    });
  }

  /**
   * Pipeline + commit history for a project since a given ref/tag,
   * used by the Release Agent to scope "what's actually in this release."
   */
  async changesSinceTag(fullPath, sinceTag) {
    return this.queryGraph({
      query_type: 'traversal',
      node: {
        id: 'p',
        entity: 'Project',
        columns: ['name', 'full_path'],
        filters: { full_path: { op: '=', value: fullPath } },
      },
      traverse: {
        relationship: 'IN_PROJECT',
        direction: 'in',
        target: {
          id: 'mr',
          entity: 'MergeRequest',
          columns: ['title', 'merged_at', 'iid', 'author'],
          filters: {
            state: { op: '=', value: 'merged' },
            merged_after_ref: { op: '=', value: sinceTag },
          },
        },
      },
      limit: 100,
    });
  }
}

export function orbitClientFromEnv() {
  return new OrbitClient({
    token: process.env.GITLAB_TOKEN,
    endpoint: process.env.ORBIT_MCP_ENDPOINT || DEFAULT_ENDPOINT,
    fullPath: process.env.GITLAB_FULL_PATH,
  });
}
