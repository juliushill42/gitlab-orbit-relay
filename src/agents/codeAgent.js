import { BaseAgent } from './baseAgent.js';

/**
 * Code Agent (stage 1)
 *
 * Input:  raw MR webhook data (changed files, touched symbols)
 * Orbit:  blastRadius() per touched symbol — who calls this, transitively?
 * Output: a grounded change-impact map the rest of the pipeline trusts
 *         instead of re-deriving from the diff.
 *
 * This is the load-bearing Orbit call: GitLab's own docs describe exactly
 * this query shape ("find all files that import AuthService directly or
 * transitively") as the flagship Orbit use case. Here it's the *first*
 * link in a relay rather than a one-off chat answer.
 */
export class CodeAgent extends BaseAgent {
  constructor(opts) {
    super({ name: 'code', ...opts });
  }

  async execute(bundle) {
    const { projectFullPath, touchedSymbols, changedFiles } = bundle.mr;

    const impactMap = {};
    for (const symbol of touchedSymbols) {
      try {
        const result = await this.orbit.blastRadius(projectFullPath, symbol);
        impactMap[symbol] = result;
      } catch (err) {
        impactMap[symbol] = { error: err.message };
      }
    }

    const totalCallers = Object.values(impactMap).reduce((sum, r) => {
      const rows = Array.isArray(r?.rows) ? r.rows.length : 0;
      return sum + rows;
    }, 0);

    const prompt = [
      `MR "${bundle.mr.title}" touched ${changedFiles.length} files and ${touchedSymbols.length} symbols.`,
      `Orbit blast-radius results:\n${JSON.stringify(impactMap, null, 2)}`,
      'Summarize the real impact surface of this change in 3-5 sentences, ',
      'calling out any caller that looks unexpected given the MR title.',
    ].join('\n');

    const modelSummary = await this.invokeModel('code', prompt);

    return {
      summary: modelSummary,
      data: {
        changedFiles,
        touchedSymbols,
        impactMap,
        totalCallersFound: totalCallers,
      },
    };
  }
}
