import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runRelay } from '../src/relay.js';
import { FakeOrbitClient } from './fakeOrbitClient.js';

const samplePayload = {
  iid: 42,
  title: 'Refactor deploy_user to support multi-region deploys',
  projectFullPath: 'titanu/justus-titanup',
  sourceBranch: 'feature/multi-region-deploy',
  targetBranch: 'main',
  mergedAt: '2026-06-22T10:00:00Z',
  author: 'julius',
  changedFiles: ['src/deploy/deployUser.js', 'src/deploy/deployUser.test.js'],
  touchedSymbols: ['deploy_user'],
};

const fixtures = {
  blastRadius: {
    deploy_user: {
      rows: [
        { name: 'deploy_user', file_path: 'src/deploy/deployUser.js' },
        { ref: { name: 'callDeployUser', file_path: 'src/orchestrator/regionManager.js' } },
        { ref: { name: 'callDeployUser', file_path: 'src/cli/deployCommand.js' } },
      ],
    },
  },
  changesSinceTag: {
    rows: [
      { title: 'Fix region failover timeout', iid: 40, author: 'julius' },
      { title: 'Add multi-region deploy support', iid: 42, author: 'julius' },
    ],
  },
};

async function stubInvokeModel(persona, prompt) {
  return `[${persona} summary] based on ${prompt.length} chars of context`;
}

test('full relay pipeline runs all four stages in order', async () => {
  const orbit = new FakeOrbitClient(fixtures);
  const bundle = await runRelay(samplePayload, { orbit, invokeModel: stubInvokeModel });

  const stageNames = bundle.stages.map((s) => s.stage);
  assert.deepEqual(stageNames, ['code', 'test', 'docs', 'release']);

  for (const stage of bundle.stages) {
    assert.ok(stage.finishedAt, `${stage.stage} stage should be finished`);
    assert.ok(stage.summary, `${stage.stage} stage should have a summary`);
  }
});

test('code stage calls Orbit blastRadius for every touched symbol', async () => {
  const orbit = new FakeOrbitClient(fixtures);
  await runRelay(samplePayload, { orbit, invokeModel: stubInvokeModel });

  const blastRadiusCalls = orbit.calls.filter((c) => c.method === 'blastRadius');
  assert.equal(blastRadiusCalls.length, 1);
  assert.equal(blastRadiusCalls[0].symbol, 'deploy_user');
  assert.equal(blastRadiusCalls[0].fullPath, 'titanu/justus-titanup');
});

test('test stage flags untested callers found by Orbit', async () => {
  const orbit = new FakeOrbitClient(fixtures);
  const bundle = await runRelay(samplePayload, { orbit, invokeModel: stubInvokeModel });

  const testStage = bundle.getStage('test');
  // regionManager.js and deployCommand.js are callers Orbit found that
  // are NOT in changedFiles -> both should be flagged as gaps.
  assert.equal(testStage.data.gapCount, 2);
  const gapFiles = testStage.data.coverageGaps.map((g) => g.callerFile);
  assert.ok(gapFiles.includes('src/orchestrator/regionManager.js'));
  assert.ok(gapFiles.includes('src/cli/deployCommand.js'));
});

test('release stage queries changesSinceTag and recommends a semver bump', async () => {
  const orbit = new FakeOrbitClient(fixtures);
  const bundle = await runRelay(samplePayload, { orbit, invokeModel: stubInvokeModel });

  const releaseStage = bundle.getStage('release');
  assert.equal(releaseStage.data.mergedSinceLastTagCount, 2);
  // gapCount > 0 from the test stage -> should recommend minor, not patch
  assert.match(releaseStage.data.recommendedBump, /minor/);

  const changesSinceTagCalls = orbit.calls.filter((c) => c.method === 'changesSinceTag');
  assert.equal(changesSinceTagCalls.length, 1);
});

test('pipeline runs with zero Orbit results without throwing', async () => {
  const orbit = new FakeOrbitClient({}); // no fixtures -> empty rows everywhere
  const bundle = await runRelay(samplePayload, { orbit, invokeModel: stubInvokeModel });

  assert.equal(bundle.stages.length, 4);
  const testStage = bundle.getStage('test');
  assert.equal(testStage.data.gapCount, 0);
});
