jest.mock('@actions/core');
const core = require('@actions/core');
const { cancel } = require('../src/cancel');
const { createOctokit, httpError } = require('./helpers');

describe('cancel', () => {
  it('cancels the run and fails the job', async () => {
    const octokit = createOctokit();
    await cancel(octokit, { owner: 'org', repo: 'repo', runId: 3, reason: 'expired' });
    expect(octokit.rest.actions.cancelWorkflowRun).toHaveBeenCalledWith({ owner: 'org', repo: 'repo', run_id: 3 });
    expect(core.setFailed).toHaveBeenCalledWith('expired');
  });

  it('still fails the job when the API call is forbidden', async () => {
    const octokit = createOctokit();
    octokit.rest.actions.cancelWorkflowRun.mockRejectedValue(httpError(403, 'Resource not accessible'));
    await cancel(octokit, { owner: 'org', repo: 'repo', runId: 3, reason: 'expired' });
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining('Resource not accessible'),
      { title: 'Cancel workflow run' },
    );
    expect(core.setFailed).toHaveBeenCalledWith('expired');
  });
});
