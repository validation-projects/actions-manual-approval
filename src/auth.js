const { createAppAuth } = require('@octokit/auth-app');
const github = require('@actions/github');

/**
 * Creates an Octokit client that refreshes its installation token as needed.
 */
async function createAppOctokit({ appId, privateKey, owner, repo }) {
  const appAuth = createAppAuth({ appId, privateKey });
  const { token: jwt } = await appAuth({ type: 'app' });

  const appOctokit = github.getOctokit(jwt);
  const { data: installation } = await appOctokit.rest.apps.getRepoInstallation({ owner, repo });

  const installationAuth = createAppAuth({
    appId,
    privateKey,
    installationId: installation.id,
    request: appOctokit.request,
  });
  return github.getOctokit(jwt, { request: { hook: installationAuth.hook } });
}

/**
 * Returns an Octokit client based on the validated auth inputs.
 */
async function resolveOctokit(auth, { owner, repo }) {
  if (auth.privateKey) {
    return createAppOctokit({ appId: auth.appId, privateKey: auth.privateKey, owner, repo });
  }
  return github.getOctokit(auth.token);
}

module.exports = { resolveOctokit, createAppOctokit };
