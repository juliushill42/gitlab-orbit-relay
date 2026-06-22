import { BaseAgent } from './baseAgent.js';

/**
 * Release Agent (stage 4, final)
 *
 * Input:  the full bundle — code impact, test gaps, docs summary
 * Orbit:  changesSinceTag() — what else merged into this project since the
 *         last release, so notes reflect the *real* release scope, not
 *         just this one MR.
 * Output: structured release notes + a semver bump recommendation with
 *         reasoning, ready to post back to GitLab (MR comment / release).
 */
export class ReleaseAgent extends BaseAgent {
  constructor(opts) {
    super({ name: 'release', ...opts });
  }

  async execute(bundle) {
    const codeStage = bundle.getStage('code');
    const testStage = bundle.getStage('test');
    const docsStage = bundle.getStage('docs');
    if (!codeStage || !testStage || !docsStage) {
      throw new Error('Release agent requires code, test, and docs stages to be complete');
    }

    let sinceTag = null;
    try {
      sinceTag = await this.orbit.changesSinceTag(
        bundle.mr.projectFullPath,
        bundle.mr.targetBranch === 'main' ? 'latest' : bundle.mr.targetBranch,
      );
    } catch (err) {
      sinceTag = { error: err.message };
    }

    const mergedSinceCount = Array.isArray(sinceTag?.rows) ? sinceTag.rows.length : 0;

    const hasCoverageRisk = testStage.data.gapCount > 0;
    const recommendedBump = hasCoverageRisk ? 'minor (verify before patch release)' : 'patch';

    const prompt = [
      `MR: "${bundle.mr.title}" by ${bundle.mr.author}`,
      `Code impact summary: ${codeStage.summary}`,
      `Test risk summary: ${testStage.summary}`,
      `Docs summary: ${docsStage.summary}`,
      `Other MRs merged into this project since last tag: ${mergedSinceCount}`,
      `Suggested semver bump: ${recommendedBump}`,
      'Write final release notes (markdown, under 200 words) combining all of the above,',
      'plus a one-line semver recommendation with reasoning.',
    ].join('\n');

    const modelSummary = await this.invokeModel('release', prompt);

    return {
      summary: modelSummary,
      data: {
        recommendedBump,
        mergedSinceLastTagCount: mergedSinceCount,
        releaseNotesMarkdown: modelSummary,
      },
    };
  }
}
