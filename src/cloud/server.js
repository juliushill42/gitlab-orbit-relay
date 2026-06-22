import express from 'express';
import crypto from 'node:crypto';

/**
 * Cloud Orchestrator
 *
 * This is the public-facing surface judges/GitLab webhooks hit. It does
 * three things and nothing else:
 *   1. Validates the inbound GitLab webhook (secret token check).
 *   2. Normalizes the payload into the shape runRelay() expects.
 *   3. Forwards to MESH_TUNNEL_URL, where the real work happens on
 *      TitanU Mesh hardware, and relays the response back.
 *
 * Deploy target: Vercel (or any Node host). Set these env vars:
 *   GITLAB_WEBHOOK_SECRET  - shared secret configured in GitLab webhook settings
 *   MESH_TUNNEL_URL        - public URL of the tunnel into your local mesh
 *                            (e.g. a Cloudflare Tunnel or equivalent pointed
 *                            at the mesh's relay HTTP listener)
 *   MESH_SHARED_SECRET     - secret shared with the mesh side, sent as a
 *                            bearer token so the tunnel isn't open to anyone
 *                            who finds the URL
 */

const app = express();
app.use(express.json({ limit: '2mb' }));

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(a || '', 'utf-8');
  const bufB = Buffer.from(b || '', 'utf-8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function verifyGitlabWebhook(req) {
  const expected = process.env.GITLAB_WEBHOOK_SECRET;
  if (!expected) return true; // not configured -> skip (dev mode)
  const received = req.headers['x-gitlab-token'];
  return timingSafeEqual(received, expected);
}

function normalizeMergeRequestPayload(body) {
  const attrs = body.object_attributes || {};
  const project = body.project || {};
  return {
    iid: attrs.iid,
    title: attrs.title,
    projectFullPath: project.path_with_namespace,
    sourceBranch: attrs.source_branch,
    targetBranch: attrs.target_branch,
    mergedAt: attrs.updated_at,
    author: body.user?.username,
    changedFiles: (body.changes?.files || []).map((f) => f.new_path || f.path).filter(Boolean),
    touchedSymbols: body.changes?.touched_symbols || [],
  };
}

app.post('/webhook/merge', async (req, res) => {
  if (!verifyGitlabWebhook(req)) {
    return res.status(401).json({ error: 'invalid webhook token' });
  }

  const event = req.headers['x-gitlab-event'];
  if (event !== 'Merge Request Hook') {
    return res.status(200).json({ skipped: true, reason: `unhandled event: ${event}` });
  }

  if (req.body.object_attributes?.action !== 'merge') {
    return res.status(200).json({ skipped: true, reason: 'not a merge action' });
  }

  const mrPayload = normalizeMergeRequestPayload(req.body);

  const meshUrl = process.env.MESH_TUNNEL_URL;
  if (!meshUrl) {
    return res.status(503).json({ error: 'MESH_TUNNEL_URL not configured' });
  }

  try {
    const meshRes = await fetch(`${meshUrl}/relay`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.MESH_SHARED_SECRET || ''}`,
      },
      body: JSON.stringify(mrPayload),
    });

    if (!meshRes.ok) {
      const text = await meshRes.text().catch(() => '');
      return res.status(502).json({ error: 'mesh relay failed', detail: text });
    }

    const result = await meshRes.json();
    return res.status(200).json(result);
  } catch (err) {
    return res.status(502).json({ error: 'mesh unreachable', detail: err.message });
  }
});

app.get('/health', (_req, res) => res.json({ ok: true, service: 'orbit-relay-cloud' }));

const port = process.env.PORT || 3000;
if (import.meta.url === `file://${process.argv[1]}`) {
  app.listen(port, () => console.log(`orbit-relay cloud orchestrator listening on :${port}`));
}

export default app;
