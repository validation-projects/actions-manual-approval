jest.mock('@actions/core');
jest.mock('@actions/github', () => ({
  context: { repo: { owner: 'org', repo: 'repo' }, runId: 42 },
  getOctokit: jest.fn(),
}));
jest.mock('../src/approval-check');
jest.mock('../src/wait', () => ({
  ...jest.requireActual('../src/wait'),
  waitForApproval: jest.fn(),
}));
jest.mock('../src/approve');
jest.mock('../src/cancel');

const core = require('@actions/core');
const github = require('@actions/github');
const { getApprovalStatus } = require('../src/approval-check');
const { waitForApproval } = require('../src/wait');
const { approve, approveReviewedAppRules } = require('../src/approve');
const { cancel } = require('../src/cancel');
const { run } = require('../src/index');

const octokit = { rest: {} };

function setInputs(values) {
  const all = { 'wait-timer': '5', 'default-action': 'approve', 'user-token': 'ghp_x', environment: 'prod', ...values };
  core.getInput.mockImplementation((name) => all[name] || '');
}

beforeEach(() => {
  github.getOctokit.mockReturnValue(octokit);
});

describe('run', () => {
  it('fails with a clear message on invalid inputs', async () => {
    setInputs({ 'app-token': 'ghs_y' });
    await run();
    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('mutually exclusive'));
    expect(waitForApproval).not.toHaveBeenCalled();
  });

  it('polls with the configured timer and skips the default action on approval', async () => {
    setInputs({});
    waitForApproval.mockImplementation(async ({ check }) => {
      await check();
      return 'approved';
    });
    await run();

    expect(github.getOctokit).toHaveBeenCalledWith('ghp_x');
    expect(waitForApproval).toHaveBeenCalledWith(expect.objectContaining({ durationMs: 300000, intervalMs: 15000 }));
    expect(getApprovalStatus).toHaveBeenCalledWith(
      octokit,
      expect.objectContaining({ owner: 'org', repo: 'repo', runId: 42, environment: 'prod' }),
    );
    expect(core.setOutput).toHaveBeenCalledWith('result', 'approved');
    expect(approve).not.toHaveBeenCalled();
    expect(approveReviewedAppRules).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it.each(['approve', 'cancel'])('approves the app rule on reviewer approval (default-action %s)', async (action) => {
    setInputs({ 'user-token': '', 'app-token': 'ghs_y', 'default-action': action });
    waitForApproval.mockResolvedValue('approved');
    await run();
    expect(approveReviewedAppRules).toHaveBeenCalledWith(octokit, { owner: 'org', repo: 'repo', runId: 42, environment: 'prod' });
    expect(core.setOutput).toHaveBeenCalledWith('result', 'approved');
    expect(cancel).not.toHaveBeenCalled();
  });

  it('skips the default action on rejection', async () => {
    setInputs({});
    waitForApproval.mockResolvedValue('rejected');
    await run();
    expect(core.setOutput).toHaveBeenCalledWith('result', 'rejected');
    expect(approve).not.toHaveBeenCalled();
  });

  it('approves on expiry when default-action is approve', async () => {
    setInputs({});
    waitForApproval.mockResolvedValue('expired');
    await run();
    expect(approve).toHaveBeenCalledWith(octokit, { mode: 'user', owner: 'org', repo: 'repo', runId: 42, environment: 'prod' });
    expect(core.setOutput).toHaveBeenCalledWith('result', 'auto-approved');
  });

  it('approves through the app on expiry with app-token', async () => {
    setInputs({ 'user-token': '', 'app-token': 'ghs_y' });
    waitForApproval.mockResolvedValue('expired');
    await run();
    expect(github.getOctokit).toHaveBeenCalledWith('ghs_y');
    expect(approve).toHaveBeenCalledWith(octokit, expect.objectContaining({ mode: 'app', environment: 'prod' }));
  });

  it('cancels on expiry when default-action is cancel', async () => {
    setInputs({ 'default-action': 'cancel' });
    waitForApproval.mockResolvedValue('expired');
    await run();
    expect(cancel).toHaveBeenCalledWith(octokit, expect.objectContaining({ owner: 'org', repo: 'repo', runId: 42 }));
    expect(core.setOutput).toHaveBeenCalledWith('result', 'cancelled');
    expect(approve).not.toHaveBeenCalled();
  });

  it('fails when the timer is aborted', async () => {
    setInputs({});
    waitForApproval.mockResolvedValue('aborted');
    await run();
    expect(core.setFailed).toHaveBeenCalledWith('Wait timer aborted before completion.');
  });

  it('fails the job when approving throws', async () => {
    setInputs({});
    waitForApproval.mockResolvedValue('expired');
    approve.mockRejectedValue(new Error('No pending deployment'));
    await run();
    expect(core.setFailed).toHaveBeenCalledWith('No pending deployment');
  });
});
