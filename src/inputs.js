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
  if (!raw) return 30;
  const value = Number(raw);
  if (!POSITIVE_INTEGER.test(raw) || value < MIN_POLL_INTERVAL || value > MAX_POLL_INTERVAL) {
    errors.push(
      `"poll-interval" must be an integer between ${MIN_POLL_INTERVAL} and ${MAX_POLL_INTERVAL} seconds, got "${raw}".`,
    );
    return undefined;
  }
  return value;
}

function parseAuth({ userToken, appToken }, errors) {
  if (userToken && appToken) {
    errors.push('"user-token" and "app-token" are mutually exclusive: provide only one of them.');
    return undefined;
  }
  if (!userToken && !appToken) {
    errors.push('One of "user-token" or "app-token" must be provided.');
    return undefined;
  }
  return userToken ? { mode: 'user', token: userToken } : { mode: 'app', token: appToken };
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
  const auth = parseAuth({ userToken: read('user-token'), appToken: read('app-token') }, errors);

  if (auth && auth.mode === 'app' && defaultAction === 'approve' && !environment) {
    errors.push('"environment" is required when approving through a GitHub App (custom protection rule).');
  }

  if (errors.length) throw new InputError(errors);

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
