/**
 * Fake OrbitClient for tests — returns deterministic fixture data instead
 * of calling the real gitlab.com/api/v4/orbit/mcp endpoint.
 */
export class FakeOrbitClient {
  constructor(fixtures = {}) {
    this.fixtures = fixtures;
    this.calls = [];
  }

  async getGraphSchema() {
    this.calls.push({ method: 'getGraphSchema' });
    return this.fixtures.schema || { node_types: [], relationship_types: [] };
  }

  async queryGraph(query) {
    this.calls.push({ method: 'queryGraph', query });
    return this.fixtures.queryGraph || { rows: [] };
  }

  async blastRadius(fullPath, symbol) {
    this.calls.push({ method: 'blastRadius', fullPath, symbol });
    const bySymbol = this.fixtures.blastRadius || {};
    return bySymbol[symbol] || { rows: [] };
  }

  async openMergeRequestCounts(groupFullPath) {
    this.calls.push({ method: 'openMergeRequestCounts', groupFullPath });
    return this.fixtures.openMergeRequestCounts || { rows: [] };
  }

  async changesSinceTag(fullPath, sinceTag) {
    this.calls.push({ method: 'changesSinceTag', fullPath, sinceTag });
    return this.fixtures.changesSinceTag || { rows: [] };
  }
}
