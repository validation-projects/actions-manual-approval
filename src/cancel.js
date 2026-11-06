const core = require('@actions/core');

/**
 * Cancels the workflow run (POST /repos/{owner}/{repo}/actions/runs/{run_id}/cancel) and fails
 * the job. If the API call is not permitted, failing the job is still guaranteed.
 */
async function cancel(octokit, { owner, repo, runId, reason }) {
  try {
    await octokit.rest.actions.cancelWorkflowRun({ owner, repo, run_id: runId });
    core.info(`Cancellation of workflow run ${runId} requested.`);
  } catch (error) {
    core.warning(
      `Could not cancel workflow run ${runId} through the API (${error.message}). ` +
        'Grant "actions: write" to the token to cancel the run; failing the job instead.',
      { title: 'Cancel workflow run' },
    );
  }
  core.setFailed(reason);
}

module.exports = { cancel };
