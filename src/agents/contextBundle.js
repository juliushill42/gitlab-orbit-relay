/**
 * The Context Bundle is the artifact that gets handed from agent to agent.
 * Each stage reads what it needs, appends its own findings, and passes the
 * whole thing forward. This is what makes it a *relay* rather than four
 * independent scripts: nothing is recomputed, and nothing is lost between
 * handoffs the way it would be between four humans on a Slack thread.
 */
export class ContextBundle {
  /**
   * @param {object} mr - merge request metadata from the GitLab webhook
   */
  constructor(mr) {
    this.mr = {
      iid: mr.iid,
      title: mr.title,
      projectFullPath: mr.projectFullPath,
      sourceBranch: mr.sourceBranch,
      targetBranch: mr.targetBranch,
      mergedAt: mr.mergedAt,
      author: mr.author,
      changedFiles: mr.changedFiles || [],
      touchedSymbols: mr.touchedSymbols || [],
    };

    /** @type {Array<{stage: string, startedAt: string, finishedAt: string|null, summary: string|null, data: object}>} */
    this.stages = [];
  }

  startStage(name) {
    const entry = {
      stage: name,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      summary: null,
      data: {},
    };
    this.stages.push(entry);
    return entry;
  }

  finishStage(entry, { summary, data }) {
    entry.finishedAt = new Date().toISOString();
    entry.summary = summary;
    entry.data = data;
  }

  getStage(name) {
    return this.stages.find((s) => s.stage === name);
  }

  toJSON() {
    return {
      mr: this.mr,
      stages: this.stages,
    };
  }
}
