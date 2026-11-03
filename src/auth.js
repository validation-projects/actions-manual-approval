const { createAppAuth } = require('@octokit/auth-app');
const github = require('@actions/github');

/**
 * Generates an installation token for the GitHub App installed on owner/repo.
 */
async function createAppInstallationToken({ appId, privateKey, owner, repo }) {
  const auth = createAppAuth({ appId, privateKey });
  const { token: jwt } = await auth({ type: 'app' });

  const appOctokit = github.getOctokit(jwt);
  const { data: installation } = await appOctokit.rest.apps.getRepoInstallation({ owner, repo });

  const { token } = await auth({ type: 'installation', installationId: installation.id });
  return token;
}

/**
 * Returns the token used for every API call, based on the validated auth inputs.
 */
async function resolveToken(auth, { owner, repo }) {
  if (auth.token) return auth.token;
  return createAppInstallationToken({ appId: auth.appId, privateKey: auth.privateKey, owner, repo });
}

module.exports = { resolveToken, createAppInstallationToken };
