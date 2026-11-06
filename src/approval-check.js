const core = require('@actions/core');

const STATUS = Object.freeze({
  APPROVED: 'approved',
  REJECTED: 'rejected',
  PENDING: 'pending',
});

function matchesEnvironment(env, target) {
  return !target || (env && env.name === target);
}

function sameUser(a, b) {
  if (!a || !b) return false;
  if (a.id && b.id) return a.id === b.id;
  return String(a.login).toLowerCase() === String(b.login).toLowerCase();
}

/**
 * Required reviewers of an environment. Cached because the pending deployment (which lists
 * the reviewers) disappears from the API as soon as it is approved.
 */
async function getRequiredReviewers(octokit, { owner, repo, environmentName, cache }) {
  if (cache.has(environmentName)) return cache.get(environmentName);

  let reviewers = null;
  try {
    const { data } = await octokit.rest.repos.getEnvironment({ owner, repo, environment_name: environmentName });
    const rule = (data.protection_rules || []).find((r) => r.type === 'required_reviewers');
    reviewers = rule ? rule.reviewers || [] : [];
  } catch (error) {
    core.debug(`Could not read protection rules of "${environmentName}": ${error.message}`);
  }
  if (reviewers) cache.set(environmentName, reviewers);
  return reviewers;
}

async function isTeamMember(octokit, { org, teamSlug, username }) {
  try {
    const { data } = await octokit.rest.teams.getMembershipForUserInOrg({ org, team_slug: teamSlug, username });
    return data.state === 'active';
  } catch (error) {
    if (error.status === 404) return false;
    throw error;
  }
}

/**
 * Returns true when `user` is one of `reviewers`, directly or through team membership.
 * When the reviewer list cannot be determined, GitHub's own enforcement (only required
 * reviewers can review a pending deployment) is trusted.
 */
async function isRequiredReviewer(octokit, { owner, user, reviewers }) {
  if (!reviewers || reviewers.length === 0) {
    core.debug('Required reviewers unknown; trusting GitHub enforcement for the review.');
    return true;
  }

  for (const { type, reviewer } of reviewers) {
    if (!reviewer) continue;
    if (type === 'User' && sameUser(reviewer, user)) return true;
    if (type === 'Team') {
      try {
        if (await isTeamMember(octokit, { org: owner, teamSlug: reviewer.slug, username: user.login })) return true;
      } catch (error) {
        core.warning(
          `Could not verify membership of "${user.login}" in team "${reviewer.slug}" (${error.message}). ` +
            'Trusting GitHub enforcement: only required reviewers can review a pending deployment.',
        );
        return true;
      }
    }
  }
  return false;
}

/**
 * Checks whether a required reviewer already reviewed the deployment(s) of the run.
 *
 * @returns {Promise<'approved'|'rejected'|'pending'>}
 */
async function getApprovalStatus(
  octokit,
  { owner, repo, runId, environment, reviewerCache = new Map(), approvedEnvironments },
) {
  const { data: pending } = await octokit.rest.actions.getPendingDeploymentsForRun({ owner, repo, run_id: runId });
  for (const deployment of pending.filter((d) => matchesEnvironment(d.environment, environment))) {
    reviewerCache.set(deployment.environment.name, deployment.reviewers || []);
  }

  const { data: reviews } = await octokit.rest.actions.getReviewsForRun({ owner, repo, run_id: runId });

  let approver;
  const newlyApprovedEnvironments = new Set();
  for (const review of reviews) {
    const environments = (review.environments || []).filter((env) => matchesEnvironment(env, environment));
    if (environments.length === 0) continue;

    for (const env of environments) {
      const reviewers = await getRequiredReviewers(octokit, { owner, repo, environmentName: env.name, cache: reviewerCache });
      if (!(await isRequiredReviewer(octokit, { owner, user: review.user, reviewers }))) continue;

      if (review.state === 'rejected') {
        core.warning(`Deployment to "${env.name}" rejected by @${review.user.login}.`, { title: 'Rejected by reviewer' });
        return STATUS.REJECTED;
      }
      if (review.state === 'approved') {
        approver = approver || `@${review.user.login} ("${env.name}")`;
        newlyApprovedEnvironments.add(env.name);
      }
    }
  }

  if (approver) {
    const { data: latestPending } = await octokit.rest.actions.getPendingDeploymentsForRun({
      owner,
      repo,
      run_id: runId,
    });
    const targetPending = latestPending.filter((d) => matchesEnvironment(d.environment, environment));
    for (const deployment of targetPending) {
      reviewerCache.set(deployment.environment.name, deployment.reviewers || []);
    }

    // An approval only counts once no deployment of the target is still waiting for review.
    if (targetPending.length > 0) return STATUS.PENDING;

    if (approvedEnvironments) {
      for (const name of newlyApprovedEnvironments) approvedEnvironments.add(name);
    }
    core.notice(`Deployment approved by required reviewer ${approver}.`, { title: 'Approved by reviewer' });
    return STATUS.APPROVED;
  }
  return STATUS.PENDING;
}

/**
 * Convenience wrapper: true when a required reviewer approved.
 */
async function isApproved(octokit, params) {
  return (await getApprovalStatus(octokit, params)) === STATUS.APPROVED;
}

module.exports = { getApprovalStatus, isApproved, isRequiredReviewer, STATUS };
