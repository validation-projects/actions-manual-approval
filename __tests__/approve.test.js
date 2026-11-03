jest.mock('@actions/core');
const { approve, approveReviewedAppRules, DEFAULT_COMMENT } = require('../src/approve');
const { createOctokit, pendingDeployment, review } = require('./helpers');

const params = { owner: 'org', repo: 'repo', runId: 7 };

describe('approve (user-token)', () => {
  it('approves the pending deployment of the target environment', async () => {
    const octokit = createOctokit({ pending: [pendingDeployment('prod', 5), pendingDeployment('staging', 6)] });
    await approve(octokit, { mode: 'user', ...params, environment: 'prod' });
    expect(octokit.rest.actions.reviewPendingDeploymentsForRun).toHaveBeenCalledWith({
      owner: 'org',
      repo: 'repo',
      run_id: 7,
      environment_ids: [5],
      state: 'approved',
      comment: DEFAULT_COMMENT,
    });
  });

  it('approves every pending deployment when no environment is given', async () => {
    const octokit = createOctokit({ pending: [pendingDeployment('prod', 5), pendingDeployment('staging', 6)] });
    await approve(octokit, { mode: 'user', ...params });
    expect(octokit.rest.actions.reviewPendingDeploymentsForRun.mock.calls[0][0].environment_ids).toEqual([5, 6]);
  });

  it('fails when there is no pending deployment', async () => {
    const octokit = createOctokit();
    await expect(approve(octokit, { mode: 'user', ...params, environment: 'prod' })).rejects.toThrow(
      'No pending deployment found for environment "prod" in run 7.',
    );
  });

  it('fails when the token owner cannot approve', async () => {
    const octokit = createOctokit({ pending: [pendingDeployment('prod', 5, [], false)] });
    await expect(approve(octokit, { mode: 'user', ...params, environment: 'prod' })).rejects.toThrow('not allowed to approve: prod');
    expect(octokit.rest.actions.reviewPendingDeploymentsForRun).not.toHaveBeenCalled();
  });
});

describe('approve (app-token)', () => {
  it('approves the custom deployment protection rule', async () => {
    const octokit = createOctokit();
    await approve(octokit, { mode: 'app', ...params, environment: 'prod' });
    expect(octokit.rest.actions.reviewCustomGatesForRun).toHaveBeenCalledWith({
      owner: 'org',
      repo: 'repo',
      run_id: 7,
      environment_name: 'prod',
      state: 'approved',
      comment: DEFAULT_COMMENT,
    });
  });

  it('requires an environment', async () => {
    await expect(approve(createOctokit(), { mode: 'app', ...params })).rejects.toThrow('"environment" is required');
  });
});

describe('approveReviewedAppRules', () => {
  it('approves the app rule of the given environment', async () => {
    const octokit = createOctokit();
    await approveReviewedAppRules(octokit, { ...params, environment: 'prod' });
    expect(octokit.rest.actions.reviewCustomGatesForRun).toHaveBeenCalledTimes(1);
    expect(octokit.rest.actions.reviewCustomGatesForRun.mock.calls[0][0].environment_name).toBe('prod');
  });

  it('approves the app rule of every approved environment when none is given', async () => {
    const octokit = createOctokit({
      reviews: [review('approved', 'prod', 'a', 1), review('approved', 'prod', 'b', 2), review('approved', 'staging', 'a', 1), review('rejected', 'dev', 'c', 3)],
    });
    await approveReviewedAppRules(octokit, params);
    expect(octokit.rest.actions.reviewCustomGatesForRun.mock.calls.map((c) => c[0].environment_name)).toEqual(['prod', 'staging']);
  });

  it('approves only environments confirmed by the required-reviewer check', async () => {
    const octokit = createOctokit();
    await approveReviewedAppRules(octokit, {
      ...params,
      environments: new Set(['prod', 'staging']),
    });
    expect(octokit.rest.actions.reviewCustomGatesForRun.mock.calls.map((c) => c[0].environment_name)).toEqual([
      'prod',
      'staging',
    ]);
    expect(octokit.rest.actions.getReviewsForRun).not.toHaveBeenCalled();
  });
});

it('rejects unknown modes', async () => {
  await expect(approve(createOctokit(), { mode: 'x', ...params })).rejects.toThrow('Unknown approval mode');
});
