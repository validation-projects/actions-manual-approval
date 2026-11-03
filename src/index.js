const core = require('@actions/core');
const github = require('@actions/github');

const { getInputs } = require('./inputs');
const { resolveToken } = require('./auth');
const { getApprovalStatus } = require('./approval-check');
const { waitForApproval, OUTCOME } = require('./wait');
const { approve } = require('./approve');
const { cancel } = require('./cancel');

async function run() {
  let inputs;
  try {
    inputs = getInputs();
  } catch (error) {
    core.setFailed(error.message);
    return;
  }

  const { owner, repo } = github.context.repo;
  const runId = github.context.runId;
  const { environment, defaultAction, auth } = inputs;
  const target = environment ? `environment "${environment}"` : 'all pending environments';

  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once('SIGINT', abort);
  process.once('SIGTERM', abort);

  try {
    const token = await resolveToken(auth, { owner, repo });
    const octokit = github.getOctokit(token);
    const reviewerCache = new Map();

    core.info(
      `Watching ${target} of run ${runId} for ${inputs.waitTimer} minute(s); ` +
        `default action on expiry: ${defaultAction}.`,
    );

    const outcome = await waitForApproval({
      durationMs: inputs.waitTimerMs,
      intervalMs: inputs.pollIntervalMs,
      signal: controller.signal,
      check: () => getApprovalStatus(octokit, { owner, repo, runId, environment, reviewerCache }),
    });

    switch (outcome) {
      case OUTCOME.APPROVED:
        core.info('Approved by a required reviewer: wait timer skipped.');
        core.setOutput('result', 'approved');
        return;
      case OUTCOME.REJECTED:
        core.warning('Rejected by a required reviewer: default action skipped.');
        core.setOutput('result', 'rejected');
        return;
      case OUTCOME.ABORTED:
        core.setFailed('Wait timer aborted before completion.');
        return;
      default:
        break;
    }

    core.info(`Wait timer of ${inputs.waitTimer} minute(s) expired without approval; running "${defaultAction}".`);
    if (defaultAction === 'approve') {
      await approve(octokit, { mode: auth.mode, owner, repo, runId, environment });
      core.setOutput('result', 'auto-approved');
    } else {
      core.setOutput('result', 'cancelled');
      await cancel(octokit, {
        owner,
        repo,
        runId,
        reason: `Wait timer of ${inputs.waitTimer} minute(s) expired without approval: workflow cancelled.`,
      });
    }
  } catch (error) {
    core.setFailed(error.message);
  } finally {
    process.removeListener('SIGINT', abort);
    process.removeListener('SIGTERM', abort);
  }
}

module.exports = { run };
