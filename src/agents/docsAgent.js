import { BaseAgent } from './baseAgent.js';

/**
 * Docs Agent (stage 3)
 *
 * Input:  Code Agent's impact map + Test Agent's coverage gaps
 * Orbit:  none directly — reuses upstream Orbit data, same relay principle
 *         as the Test Agent.
 * Output: a short "what changed and what it affects" doc section, grounded
 *         in real callers instead of a guess from the commit message.
 */
export class DocsAgent extends BaseAgent {
  constructor(opts) {
    super({ name: 'docs', ...opts });
  }

  async execute(bundle) {
    const codeStage = bundle.getStage('code');
    const testStage = bundle.getStage('test');
    if (!codeStage || !testStage) {
      throw new Error('Docs agent requires completed code and test stages');
    }

    const affectedFiles = new Set();
    for (const result of Object.values(codeStage.data.impactMap)) {
      const rows = Array.isArray(result?.rows) ? result.rows : [];
      for (const row of rows) {
        const f = row.file_path || row.ref?.file_path;
        if (f) affectedFiles.add(f);
      }
    }

    const prompt = [
      `MR title: "${bundle.mr.title}"`,
      `Touched symbols: ${bundle.mr.touchedSymbols.join(', ')}`,
      `Real downstream-affected files (from Orbit, ${affectedFiles.size} total): ${[...affectedFiles].slice(0, 25).join(', ')}`,
      `Coverage gaps flagged by test stage: ${testStage.data.gapCount}`,
      'Write a short "What changed and what it affects" doc section (4-8 sentences),',
      'grounded in the actual affected files above, not assumptions from the title.',
    ].join('\n');

    const modelSummary = await this.invokeModel('docs', prompt);

    return {
      summary: modelSummary,
      data: {
        affectedFiles: [...affectedFiles],
        affectedFileCount: affectedFiles.size,
      },
    };
  }
}
