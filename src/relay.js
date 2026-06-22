import { ContextBundle } from './agents/contextBundle.js';
import { CodeAgent } from './agents/codeAgent.js';
import { TestAgent } from './agents/testAgent.js';
import { DocsAgent } from './agents/docsAgent.js';
import { ReleaseAgent } from './agents/releaseAgent.js';
import { orbitClientFromEnv } from './orbit/client.js';

/**
 * Runs the full Code -> Test -> Docs -> Release relay against one MR.
 *
 * @param {object} mrPayload - normalized MR data (see contextBundle.js)
 * @param {object} [opts]
 * @param {import('./orbit/client.js').OrbitClient} [opts.orbit]
 * @param {(persona: string, prompt: string) => Promise<string>} [opts.invokeModel]
 *   Pass this to wire in your TitanU Mesh llama-server backend. If omitted,
 *   each agent falls back to a deterministic stub so the pipeline still runs.
 * @returns {Promise<import('./agents/contextBundle.js').ContextBundle>}
 */
export async function runRelay(mrPayload, opts = {}) {
  const orbit = opts.orbit || orbitClientFromEnv();
  const bundle = new ContextBundle(mrPayload);

  const agents = [
    new CodeAgent({ orbit, invokeModel: opts.invokeModel }),
    new TestAgent({ orbit, invokeModel: opts.invokeModel }),
    new DocsAgent({ orbit, invokeModel: opts.invokeModel }),
    new ReleaseAgent({ orbit, invokeModel: opts.invokeModel }),
  ];

  for (const agent of agents) {
    await agent.run(bundle);
  }

  return bundle;
}

// CLI entry point: node src/relay.js path/to/mr-payload.json
if (import.meta.url === `file://${process.argv[1]}`) {
  const fs = await import('node:fs/promises');
  const payloadPath = process.argv[2];
  if (!payloadPath) {
    console.error('Usage: node src/relay.js <path-to-mr-payload.json>');
    process.exit(1);
  }
  const raw = await fs.readFile(payloadPath, 'utf-8');
  const mrPayload = JSON.parse(raw);
  const bundle = await runRelay(mrPayload);
  console.log(JSON.stringify(bundle.toJSON(), null, 2));
}
