function httpError(status, message = `HTTP ${status}`) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function createOctokit({ pending = [], reviews = [], environment, membership } = {}) {
  return {
    rest: {
      actions: {
        getPendingDeploymentsForRun: jest.fn().mockResolvedValue({ data: pending }),
        getReviewsForRun: jest.fn().mockResolvedValue({ data: reviews }),
        reviewPendingDeploymentsForRun: jest.fn().mockResolvedValue({ data: [] }),
        reviewCustomGatesForRun: jest.fn().mockResolvedValue({}),
        cancelWorkflowRun: jest.fn().mockResolvedValue({}),
      },
      repos: {
        getEnvironment: environment
          ? jest.fn().mockResolvedValue({ data: environment })
          : jest.fn().mockRejectedValue(httpError(404)),
      },
      teams: {
        getMembershipForUserInOrg: membership || jest.fn().mockRejectedValue(httpError(404)),
      },
      apps: {
        getRepoInstallation: jest.fn().mockResolvedValue({ data: { id: 99 } }),
      },
    },
  };
}

function pendingDeployment(name, id, reviewers = [], currentUserCanApprove = true) {
  return { environment: { id, name }, reviewers, current_user_can_approve: currentUserCanApprove };
}

function review(state, envName, login, id) {
  return { state, environments: [{ name: envName }], user: { login, id }, comment: '' };
}

module.exports = { createOctokit, pendingDeployment, review, httpError };
