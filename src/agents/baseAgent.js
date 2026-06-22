/**
 * BaseAgent defines the contract every stage of the relay implements.
 *
 * `invokeModel` is intentionally a pluggable hook rather than a hardcoded
 * call: in this standalone repo it defaults to a stub that returns
 * deterministic placeholder text (so the pipeline is runnable and testable
 * with zero external dependencies). When wired into TitanU Mesh, replace
 * this hook with a call to your llama-server instance, model-swapped to
 * the matching persona.
 *
 * Expected llama-server integration shape (for reference, not required by
 * this repo):
 *
 *   async function invokeMeshPersona(persona, prompt) {
 *     const res = await fetch('http://localhost:8080/completion', {
 *       method: 'POST',
 *       headers: { 'Content-Type': 'application/json' },
 *       body: JSON.stringify({ prompt, model: persona }),
 *     });
 *     return (await res.json()).content;
 *   }
 */
export class BaseAgent {
  /**
   * @param {object} opts
   * @param {string} opts.name - stage name, e.g. 'code', 'test', 'docs', 'release'
   * @param {import('../orbit/client.js').OrbitClient} opts.orbit
   * @param {(persona: string, prompt: string) => Promise<string>} [opts.invokeModel]
   */
  constructor({ name, orbit, invokeModel }) {
    this.name = name;
    this.orbit = orbit;
    this.invokeModel = invokeModel || this._stubInvoke.bind(this);
  }

  async _stubInvoke(persona, prompt) {
    return `[stub:${persona}] no model backend configured — prompt was ${prompt.length} chars`;
  }

  /**
   * Run this stage against the bundle. Subclasses implement `execute`.
   * @param {import('./contextBundle.js').ContextBundle} bundle
   */
  async run(bundle) {
    const entry = bundle.startStage(this.name);
    try {
      const result = await this.execute(bundle);
      bundle.finishStage(entry, result);
      return bundle;
    } catch (err) {
      bundle.finishStage(entry, {
        summary: `FAILED: ${err.message}`,
        data: { error: err.message },
      });
      throw err;
    }
  }

  /**
   * @abstract
   * @param {import('./contextBundle.js').ContextBundle} bundle
   * @returns {Promise<{summary: string, data: object}>}
   */
  async execute(_bundle) {
    throw new Error(`${this.name} agent must implement execute()`);
  }
}
