const core = require('@actions/core');

const DEFAULT_COMMENT = 'Automatically approved by actions-manual-approval: wait timer expired without review.';

/**
 * Approves the run's pending deployments with a required reviewer PAT
 * (POST /repos/{owner}/{repo}/actions/runs/{run_id}/pending_deployments).
 */
async function approveWithUserToken(octokit, { owner, repo, runId, environment, comment = DEFAULT_COMMENT }) {
  const { data: pending } = await octokit.rest.actions.getPendingDeploymentsForRun({ owner, repo, run_id: runId });
  const targets = pending.filter((d) => !environment || d.environment.name === environment);

  if (targets.length === 0) {
    throw new Error(
      `No pending deployment found for ${environment ? `environment "${environment}"` : 'any environment'} in run ${runId}.`,
    );
  }

  const forbidden = targets.filter((d) => d.current_user_can_approve === false);
  if (forbidden.length) {
    throw new Error(
      `The owner of "user-token" is not allowed to approve: ${forbidden.map((d) => d.environment.name).join(', ')}. ` +
        'The token must belong to a required reviewer of the environment.',
    );
  }

  await octokit.rest.actions.reviewPendingDeploymentsForRun({
    owner,
    repo,
    run_id: runId,
    environment_ids: targets.map((d) => d.environment.id),
    state: 'approved',
    comment,
  });
  core.info(`Approved pending deployment(s): ${targets.map((d) => d.environment.name).join(', ')}.`);
}

/**
 * Approves the custom deployment protection rule with a GitHub App installation token
 * (POST /repos/{owner}/{repo}/actions/runs/{run_id}/deployment_protection_rule).
 */
async function approveWithAppToken(octokit, { owner, repo, runId, environment, comment = DEFAULT_COMMENT }) {
  if (!environment) {
    throw new Error('"environment" is required to approve a custom deployment protection rule.');
  }
  await octokit.rest.actions.reviewCustomGatesForRun({
    owner,
    repo,
    run_id: runId,
    environment_name: environment,
    state: 'approved',
    comment,
  });
  core.info(`Approved custom deployment protection rule for "${environment}".`);
}

/**
 * After a required reviewer approved, answers the App's custom protection rule for the reviewed
 * environment(s), which GitHub otherwise keeps blocking.
 */
async function approveReviewedAppRules(octokit, { owner, repo, runId, environment, comment }) {
  let names = [environment];
  if (!environment) {
    const { data: reviews } = await octokit.rest.actions.getReviewsForRun({ owner, repo, run_id: runId });
    names = [
      ...new Set(
        reviews
          .filter((r) => r.state === 'approved')
          .flatMap((r) => (r.environments || []).map((env) => env.name)),
      ),
    ];
  }
  for (const name of names) {
    await approveWithAppToken(octokit, { owner, repo, runId, environment: name, comment });
  }
}

async function approve(octokit, { mode, ...params }) {
  if (mode === 'user') return approveWithUserToken(octokit, params);
  if (mode === 'app') return approveWithAppToken(octokit, params);
  throw new Error(`Unknown approval mode "${mode}".`);
}

module.exports = { approve, approveWithUserToken, approveWithAppToken, approveReviewedAppRules, DEFAULT_COMMENT };
