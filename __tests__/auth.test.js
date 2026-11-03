jest.mock('@octokit/auth-app');
jest.mock('@actions/github');
const { createAppAuth } = require('@octokit/auth-app');
const github = require('@actions/github');
const { resolveToken } = require('../src/auth');
const { createOctokit } = require('./helpers');

describe('resolveToken', () => {
  it('returns the provided token as is', async () => {
    await expect(resolveToken({ mode: 'user', token: 'ghp_x' }, {})).resolves.toBe('ghp_x');
    expect(createAppAuth).not.toHaveBeenCalled();
  });

  it('creates an installation token from app-id/app-private-key', async () => {
    const auth = jest.fn(async ({ type }) => ({ token: type === 'app' ? 'jwt' : 'ghs_install' }));
    createAppAuth.mockReturnValue(auth);
    const appOctokit = createOctokit();
    github.getOctokit.mockReturnValue(appOctokit);

    const token = await resolveToken({ mode: 'app', appId: '1', privateKey: 'PEM' }, { owner: 'org', repo: 'repo' });

    expect(token).toBe('ghs_install');
    expect(createAppAuth).toHaveBeenCalledWith({ appId: '1', privateKey: 'PEM' });
    expect(github.getOctokit).toHaveBeenCalledWith('jwt');
    expect(appOctokit.rest.apps.getRepoInstallation).toHaveBeenCalledWith({ owner: 'org', repo: 'repo' });
    expect(auth).toHaveBeenLastCalledWith({ type: 'installation', installationId: 99 });
  });
});
