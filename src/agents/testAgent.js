import { BaseAgent } from './baseAgent.js';

/**
 * Test Agent (stage 2)
 *
 * Input:  the Code Agent's impact map (callers of every touched symbol)
 * Orbit:  none directly — this stage consumes the prior stage's Orbit data
 *         rather than re-querying, which is the point of a relay: context
 *         compounds instead of resetting at each handoff.
 * Output: a coverage-gap list — callers Orbit surfaced that the MR's own
 *         test diff doesn't appear to touch.
 */
export class TestAgent extends BaseAgent {
  constructor(opts) {
    super({ name: 'test', ...opts });
  }

  async execute(bundle) {
    const codeStage = bundle.getStage('code');
    if (!codeStage || !codeStage.data.impactMap) {
      throw new Error('Test agent requires a completed code stage with impactMap');
    }

    const { impactMap } = codeStage.data;
    const { changedFiles } = bundle.mr;
    const changedSet = new Set(changedFiles);

    const gaps = [];
    for (const [symbol, result] of Object.entries(impactMap)) {
      const rows = Array.isArray(result?.rows) ? result.rows : [];
      for (const row of rows) {
        const callerFile = row.file_path || row.ref?.file_path;
        if (callerFile && !changedSet.has(callerFile) && !callerFile.includes('.test.') && !callerFile.includes('.spec.')) {
          gaps.push({ symbol, callerFile });
        }
      }
    }

    const prompt = [
      `Touched symbols: ${Object.keys(impactMap).join(', ')}`,
      `Callers found by Orbit that are NOT part of this MR's changed files`,
      `and don't look like test files (${gaps.length} total):`,
      JSON.stringify(gaps, null, 2),
      'Write a 3-5 sentence test-coverage risk assessment. Flag the riskiest',
      'untested call site, if any. Be concrete, not generic.',
    ].join('\n');

    const modelSummary = await this.invokeModel('test', prompt);

    return {
      summary: modelSummary,
      data: {
        coverageGaps: gaps,
        gapCount: gaps.length,
      },
    };
  }
}
