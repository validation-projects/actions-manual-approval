jest.mock('@actions/core');
const { getApprovalStatus, isApproved, STATUS } = require('../src/approval-check');
const { createOctokit, pendingDeployment, review, httpError } = require('./helpers');

const params = { owner: 'org', repo: 'repo', runId: 1, environment: 'prod' };
const alice = { type: 'User', reviewer: { login: 'alice', id: 1 } };
const team = { type: 'Team', reviewer: { slug: 'release', id: 10 } };

describe('getApprovalStatus', () => {
  it('is pending while the deployment waits for review', async () => {
    const octokit = createOctokit({ pending: [pendingDeployment('prod', 5, [alice])] });
    await expect(getApprovalStatus(octokit, params)).resolves.toBe(STATUS.PENDING);
    expect(octokit.rest.actions.getPendingDeploymentsForRun).toHaveBeenCalledWith({ owner: 'org', repo: 'repo', run_id: 1 });
  });

  it('is pending before the deployment is created', async () => {
    const octokit = createOctokit();
    await expect(getApprovalStatus(octokit, params)).resolves.toBe(STATUS.PENDING);
  });

  it('detects an approval by a required user reviewer (reviewers cached from earlier poll)', async () => {
    const octokit = createOctokit({ pending: [pendingDeployment('prod', 5, [alice])] });
    const reviewerCache = new Map();
    await getApprovalStatus(octokit, { ...params, reviewerCache });

    octokit.rest.actions.getPendingDeploymentsForRun.mockResolvedValue({ data: [] });
    octokit.rest.actions.getReviewsForRun.mockResolvedValue({ data: [review('approved', 'prod', 'alice', 1)] });
    await expect(getApprovalStatus(octokit, { ...params, reviewerCache })).resolves.toBe(STATUS.APPROVED);
    expect(octokit.rest.repos.getEnvironment).not.toHaveBeenCalled();
  });

  it('falls back to environment protection rules for the reviewer list', async () => {
    const octokit = createOctokit({
      reviews: [review('approved', 'prod', 'alice', 1)],
      environment: { protection_rules: [{ type: 'wait_timer' }, { type: 'required_reviewers', reviewers: [alice] }] },
    });
    await expect(isApproved(octokit, params)).resolves.toBe(true);
    expect(octokit.rest.repos.getEnvironment).toHaveBeenCalledWith({ owner: 'org', repo: 'repo', environment_name: 'prod' });
  });

  it('ignores approvals from users that are not required reviewers', async () => {
    const octokit = createOctokit({
      reviews: [review('approved', 'prod', 'mallory', 2)],
      environment: { protection_rules: [{ type: 'required_reviewers', reviewers: [alice] }] },
    });
    await expect(getApprovalStatus(octokit, params)).resolves.toBe(STATUS.PENDING);
  });

  it('ignores approvals for other environments', async () => {
    const octokit = createOctokit({ reviews: [review('approved', 'staging', 'alice', 1)] });
    await expect(getApprovalStatus(octokit, params)).resolves.toBe(STATUS.PENDING);
  });

  it('stays pending while a deployment of the target is still waiting', async () => {
    const octokit = createOctokit({
      pending: [pendingDeployment('prod', 5, [alice])],
      reviews: [review('approved', 'prod', 'alice', 1)],
    });
    await expect(getApprovalStatus(octokit, params)).resolves.toBe(STATUS.PENDING);
  });

  it('accepts approvals from members of a required team', async () => {
    const membership = jest.fn().mockResolvedValue({ data: { state: 'active' } });
    const octokit = createOctokit({
      reviews: [review('approved', 'prod', 'bob', 3)],
      environment: { protection_rules: [{ type: 'required_reviewers', reviewers: [team] }] },
      membership,
    });
    await expect(getApprovalStatus(octokit, params)).resolves.toBe(STATUS.APPROVED);
    expect(membership).toHaveBeenCalledWith({ org: 'org', team_slug: 'release', username: 'bob' });
  });

  it('rejects approvals from non-members of a required team (404) and pending memberships', async () => {
    const env = { protection_rules: [{ type: 'required_reviewers', reviewers: [team] }] };
    const notMember = createOctokit({ reviews: [review('approved', 'prod', 'bob', 3)], environment: env });
    await expect(getApprovalStatus(notMember, params)).resolves.toBe(STATUS.PENDING);

    const invited = createOctokit({
      reviews: [review('approved', 'prod', 'bob', 3)],
      environment: env,
      membership: jest.fn().mockResolvedValue({ data: { state: 'pending' } }),
    });
    await expect(getApprovalStatus(invited, params)).resolves.toBe(STATUS.PENDING);
  });

  it('trusts GitHub enforcement when team membership cannot be read', async () => {
    const octokit = createOctokit({
      reviews: [review('approved', 'prod', 'bob', 3)],
      environment: { protection_rules: [{ type: 'required_reviewers', reviewers: [team] }] },
      membership: jest.fn().mockRejectedValue(httpError(403)),
    });
    await expect(getApprovalStatus(octokit, params)).resolves.toBe(STATUS.APPROVED);
  });

  it('trusts GitHub enforcement when reviewers are unknown', async () => {
    const octokit = createOctokit({ reviews: [review('approved', 'prod', 'alice', 1)] });
    await expect(getApprovalStatus(octokit, params)).resolves.toBe(STATUS.APPROVED);
  });

  it('detects a rejection', async () => {
    const octokit = createOctokit({ reviews: [review('rejected', 'prod', 'alice', 1)] });
    await expect(getApprovalStatus(octokit, params)).resolves.toBe(STATUS.REJECTED);
  });

  it('watches every environment when none is given', async () => {
    const octokit = createOctokit({ reviews: [review('approved', 'staging', 'alice', 1)] });
    await expect(getApprovalStatus(octokit, { ...params, environment: undefined })).resolves.toBe(STATUS.APPROVED);
  });
});
