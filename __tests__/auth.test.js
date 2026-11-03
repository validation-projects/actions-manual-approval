jest.mock('@octokit/auth-app');
jest.mock('@actions/github');
const { createAppAuth } = require('@octokit/auth-app');
const github = require('@actions/github');
const { resolveOctokit } = require('../src/auth');
const { createOctokit } = require('./helpers');

describe('resolveOctokit', () => {
  it('returns the provided token as is', async () => {
    const octokit = createOctokit();
    github.getOctokit.mockReturnValue(octokit);

    await expect(resolveOctokit({ mode: 'user', token: 'ghp_x' }, {})).resolves.toBe(octokit);
    expect(github.getOctokit).toHaveBeenCalledWith('ghp_x');
    expect(createAppAuth).not.toHaveBeenCalled();
  });

  it('creates an auto-refreshing client and uses the configured API host for App requests', async () => {
    const auth = jest.fn().mockResolvedValue({ token: 'jwt' });
    auth.hook = jest.fn();
    createAppAuth.mockReturnValue(auth);
    const appOctokit = createOctokit();
    appOctokit.request = jest.fn();
    github.getOctokit.mockReturnValue(appOctokit);

    const octokit = await resolveOctokit(
      { mode: 'app', appId: '1', privateKey: 'PEM' },
      { owner: 'org', repo: 'repo' },
    );

    expect(octokit).toBe(appOctokit);
    expect(createAppAuth).toHaveBeenNthCalledWith(1, { appId: '1', privateKey: 'PEM' });
    expect(github.getOctokit).toHaveBeenCalledWith('jwt');
    expect(appOctokit.rest.apps.getRepoInstallation).toHaveBeenCalledWith({ owner: 'org', repo: 'repo' });
    expect(createAppAuth).toHaveBeenNthCalledWith(2, {
      appId: '1',
      privateKey: 'PEM',
      installationId: 99,
      request: appOctokit.request,
    });
    expect(github.getOctokit).toHaveBeenLastCalledWith('jwt', { request: { hook: auth.hook } });
  });
});
