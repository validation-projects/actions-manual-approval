const core = require('@actions/core');
const github = require('@actions/github');

const { getInputs } = require('./inputs');
const { getApprovalStatus } = require('./approval-check');
const { waitForApproval, formatDuration, OUTCOME } = require('./wait');
const { approve, approveReviewedAppRules } = require('./approve');
const { cancel } = require('./cancel');
const { writeConfigurationSummary, writeResultSummary } = require('./summary');

function logConfiguration(config) {
  core.startGroup('Configuration');
  core.info(`wait-timer: ${config.waitTimer} minute(s)`);
  core.info(`poll-interval: ${config.pollInterval} second(s)`);
  core.info(`environment: ${config.environment || '(all pending environments)'}`);
  core.info(`default-action: ${config.defaultAction}`);
  core.info(`auth: ${config.authMode}-token`);
  core.info(`run id: ${config.runId}`);
  core.endGroup();
}

async function run() {
  const startedAt = Date.now();
  const status = { result: 'error', executedAction: undefined, reason: 'Unexpected error.' };
  let inputs;

  const controller = new AbortController();
  const abort = () => controller.abort();

  try {
    try {
      inputs = getInputs();
    } catch (error) {
      status.reason = error.message;
      core.setFailed(error.message);
      return;
    }

    const { owner, repo } = github.context.repo;
    const runId = github.context.runId;
    const { environment, defaultAction, auth, waitTimer } = inputs;
    const target = environment ? `environment "${environment}"` : 'all pending environments';
    const config = {
      waitTimer,
      pollInterval: inputs.pollIntervalMs / 1000,
      environment,
      defaultAction,
      authMode: auth.mode,
      runId,
    };

    logConfiguration(config);
    await writeConfigurationSummary(config);

    process.once('SIGINT', abort);
    process.once('SIGTERM', abort);

    const octokit = github.getOctokit(auth.token);
    const reviewerCache = new Map();
    const approvedEnvironments = new Set();

    core.notice(
      `Watching ${target} of run ${runId} for ${waitTimer} minute(s); default action on expiry: ${defaultAction}.`,
      { title: 'Wait timer started' },
    );

    const outcome = await waitForApproval({
      durationMs: inputs.waitTimerMs,
      intervalMs: inputs.pollIntervalMs,
      signal: controller.signal,
      check: () =>
        getApprovalStatus(octokit, { owner, repo, runId, environment, reviewerCache, approvedEnvironments }),
    });

    switch (outcome) {
      case OUTCOME.APPROVED:
        if (auth.mode === 'app') {
          await approveReviewedAppRules(octokit, {
            owner,
            repo,
            runId,
            environment,
            environments: approvedEnvironments,
          });
        }
        core.setOutput('result', 'approved');
        Object.assign(status, {
          result: 'approved',
          reason: 'A required reviewer approved before the wait timer expired.',
        });
        core.notice('Approved by a required reviewer: wait timer skipped.', { title: 'Result: approved' });
        return;
      case OUTCOME.REJECTED:
        core.setOutput('result', 'rejected');
        Object.assign(status, { result: 'rejected', reason: 'A required reviewer rejected the deployment.' });
        core.warning('Rejected by a required reviewer: default action skipped.', { title: 'Result: rejected' });
        return;
      case OUTCOME.ABORTED:
        Object.assign(status, {
          result: 'aborted',
          reason: 'Wait timer aborted before completion (job cancelled or runner shutting down).',
        });
        core.setFailed('Wait timer aborted before completion.');
        return;
      default:
        break;
    }

    const expired = `Wait timer of ${waitTimer} minute(s) expired without approval`;
    core.notice(`${expired}; running "${defaultAction}".`, { title: 'Wait timer expired' });
    status.executedAction = defaultAction;
    if (defaultAction === 'approve') {
      await approve(octokit, { mode: auth.mode, owner, repo, runId, environment });
      core.setOutput('result', 'auto-approved');
      Object.assign(status, { result: 'auto-approved', reason: `${expired}: pending deployment approved.` });
      core.notice(`${expired}: pending deployment approved.`, { title: 'Result: auto-approved' });
    } else {
      core.setOutput('result', 'cancelled');
      Object.assign(status, { result: 'cancelled', reason: `${expired}: workflow cancelled.` });
      await cancel(octokit, { owner, repo, runId, reason: `${expired}: workflow cancelled.` });
    }
  } catch (error) {
    Object.assign(status, {
      result: 'error',
      executedAction: status.executedAction && `${status.executedAction} (failed)`,
      reason: error.message,
    });
    core.setFailed(error.message);
  } finally {
    process.removeListener('SIGINT', abort);
    process.removeListener('SIGTERM', abort);
    await writeResultSummary({
      ...status,
      elapsed: formatDuration(Math.floor((Date.now() - startedAt) / 1000) * 1000),
      defaultAction: inputs && inputs.defaultAction,
    });
  }
}

module.exports = { run };
