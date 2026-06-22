import express from 'express';
import crypto from 'node:crypto';
import { runRelay } from '../relay.js';
import { orbitClientFromEnv } from '../orbit/client.js';

/**
 * Mesh-side relay listener.
 *
 * Run this ON the TitanU Mesh host (titanu). Expose it to the internet via
 * a tunnel (Cloudflare Tunnel, ngrok, or your existing reverse-proxy setup),
 * and point the cloud orchestrator's MESH_TUNNEL_URL at that tunnel's
 * public URL.
 *
 * This file owns the one integration point that matters: `invokeModel`.
 * Wire it to your llama-server instance with model-swapping across the
 * 4 release-pipeline personas (code / test / docs / release), the same
 * way your existing 12 personas are dispatched.
 *
 * Env vars:
 *   MESH_PORT             - local port to listen on (default 8090)
 *   MESH_SHARED_SECRET    - must match the cloud orchestrator's secret
 *   LLAMA_SERVER_URL      - e.g. http://localhost:8080
 *   GITLAB_TOKEN          - for the OrbitClient
 */

async function invokeMeshPersona(persona, prompt) {
  const llamaUrl = process.env.LLAMA_SERVER_URL;
  if (!llamaUrl) {
    return `[no LLAMA_SERVER_URL set — stub response for persona '${persona}']`;
  }

  // Adjust this payload shape to match however your mesh's model-swap
  // dispatcher expects to receive persona + prompt. This assumes a
  // llama-server /completion endpoint with a `model` field used by your
  // router to select which of the 5 GGUF files to swap in.
  const res = await fetch(`${llamaUrl}/completion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      model: persona,
      n_predict: 512,
      temperature: 0.3,
    }),
  });

  if (!res.ok) {
    throw new Error(`llama-server returned ${res.status} for persona '${persona}'`);
  }

  const json = await res.json();
  return json.content || json.completion || JSON.stringify(json);
}

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(a || '', 'utf-8');
  const bufB = Buffer.from(b || '', 'utf-8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

const app = express();
app.use(express.json({ limit: '2mb' }));

app.post('/relay', async (req, res) => {
  const expected = process.env.MESH_SHARED_SECRET;
  if (expected) {
    const auth = req.headers.authorization || '';
    const token = auth.replace(/^Bearer\s+/i, '');
    if (!timingSafeEqual(token, expected)) {
      return res.status(401).json({ error: 'invalid mesh secret' });
    }
  }

  try {
    const orbit = orbitClientFromEnv();
    const bundle = await runRelay(req.body, {
      orbit,
      invokeModel: invokeMeshPersona,
    });
    return res.status(200).json(bundle.toJSON());
  } catch (err) {
    return res.status(500).json({ error: 'relay failed', detail: err.message });
  }
});

app.get('/health', (_req, res) => res.json({ ok: true, service: 'orbit-relay-mesh' }));

const port = process.env.MESH_PORT || 8090;
app.listen(port, () => console.log(`orbit-relay mesh listener on :${port}`));
