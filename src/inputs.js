const core = require('@actions/core');

const DEFAULT_ACTIONS = ['approve', 'cancel'];
const MIN_POLL_INTERVAL = 5;
const MAX_POLL_INTERVAL = 300;
const POSITIVE_INTEGER = /^[1-9]\d*$/;

class InputError extends Error {
  constructor(errors) {
    super(`Invalid inputs:\n- ${errors.join('\n- ')}`);
    this.name = 'InputError';
    this.errors = errors;
  }
}

function read(name) {
  return core.getInput(name, { required: false }).trim();
}

function parseWaitTimer(raw, errors) {
  if (!raw) {
    errors.push('"wait-timer" is required (time in minutes).');
    return undefined;
  }
  if (!POSITIVE_INTEGER.test(raw)) {
    errors.push(`"wait-timer" must be a positive integer number of minutes, got "${raw}".`);
    return undefined;
  }
  return Number(raw);
}

function parseDefaultAction(raw, errors) {
  const value = raw.toLowerCase();
  if (!value) {
    errors.push(`"default-action" is required: one of ${DEFAULT_ACTIONS.join(' | ')}.`);
    return undefined;
  }
  if (!DEFAULT_ACTIONS.includes(value)) {
    errors.push(`"default-action" must be one of ${DEFAULT_ACTIONS.join(' | ')}, got "${raw}".`);
    return undefined;
  }
  return value;
}

function parsePollInterval(raw, errors) {
  if (!raw) return 15;
  const value = Number(raw);
  if (!POSITIVE_INTEGER.test(raw) || value < MIN_POLL_INTERVAL || value > MAX_POLL_INTERVAL) {
    errors.push(
      `"poll-interval" must be an integer between ${MIN_POLL_INTERVAL} and ${MAX_POLL_INTERVAL} seconds, got "${raw}".`,
    );
    return undefined;
  }
  return value;
}

function parseAuth({ userToken, appToken, appId, appPrivateKey }, errors) {
  if ((appId && !appPrivateKey) || (!appId && appPrivateKey)) {
    errors.push('"app-id" and "app-private-key" must be provided together.');
    return undefined;
  }
  if (appToken && appId) {
    errors.push('Use either "app-token" or "app-id"/"app-private-key", not both.');
    return undefined;
  }

  const hasApp = Boolean(appToken || appId);
  if (userToken && hasApp) {
    errors.push('"user-token" and "app-token" are mutually exclusive: provide only one of them.');
    return undefined;
  }
  if (!userToken && !hasApp) {
    errors.push('One of "user-token" or "app-token" must be provided.');
    return undefined;
  }

  if (userToken) return { mode: 'user', token: userToken };
  if (appToken) return { mode: 'app', token: appToken };
  return { mode: 'app', appId, privateKey: appPrivateKey };
}

/**
 * Reads and validates the action inputs.
 * @throws {InputError} with every validation error found.
 */
function getInputs() {
  const errors = [];

  const waitTimer = parseWaitTimer(read('wait-timer'), errors);
  const defaultAction = parseDefaultAction(read('default-action'), errors);
  const pollInterval = parsePollInterval(read('poll-interval'), errors);
  const environment = read('environment') || undefined;
  const auth = parseAuth(
    {
      userToken: read('user-token'),
      appToken: read('app-token'),
      appId: read('app-id'),
      appPrivateKey: read('app-private-key'),
    },
    errors,
  );

  if (auth && auth.mode === 'app' && defaultAction === 'approve' && !environment) {
    errors.push('"environment" is required when approving through a GitHub App (custom protection rule).');
  }

  if (errors.length) throw new InputError(errors);

  if (auth.privateKey) core.setSecret(auth.privateKey);

  return {
    waitTimer,
    waitTimerMs: waitTimer * 60 * 1000,
    defaultAction,
    pollIntervalMs: pollInterval * 1000,
    environment,
    auth,
  };
}

module.exports = { getInputs, InputError, DEFAULT_ACTIONS };
