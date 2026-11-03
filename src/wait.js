const core = require('@actions/core');

const OUTCOME = Object.freeze({
  APPROVED: 'approved',
  REJECTED: 'rejected',
  EXPIRED: 'expired',
  ABORTED: 'aborted',
});

/**
 * Resolves after `ms` or as soon as `signal` is aborted.
 */
function sleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal && signal.aborted) return resolve();
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m${String(seconds).padStart(2, '0')}s`;
}

/**
 * Polls `check` every `intervalMs` until it reports a review, `durationMs` elapses or `signal`
 * is aborted. A last check runs when the timer expires to avoid missing a late approval.
 *
 * @param {object} options
 * @param {number} options.durationMs
 * @param {number} options.intervalMs
 * @param {() => Promise<'approved'|'rejected'|'pending'>} options.check
 * @param {AbortSignal} [options.signal]
 * @param {() => number} [options.now]
 * @returns {Promise<'approved'|'rejected'|'expired'|'aborted'>}
 */
async function waitForApproval({ durationMs, intervalMs, check, signal, now = Date.now }) {
  const deadline = now() + durationMs;

  const poll = async () => {
    try {
      const status = await check();
      if (signal && signal.aborted) return OUTCOME.ABORTED;
      if (status === OUTCOME.APPROVED || status === OUTCOME.REJECTED) return status;
    } catch (error) {
      if (signal && signal.aborted) return OUTCOME.ABORTED;
      core.warning(`Approval check failed, retrying on next poll: ${error.message}`);
    }
    return null;
  };

  for (;;) {
    if (signal && signal.aborted) return OUTCOME.ABORTED;

    const result = await poll();
    if (result) return result;

    const remaining = deadline - now();
    if (remaining <= 0) return OUTCOME.EXPIRED;

    core.info(`Waiting for a required reviewer... ${formatDuration(remaining)} left.`);
    await sleep(Math.min(intervalMs, remaining), signal);

    if (signal && signal.aborted) return OUTCOME.ABORTED;
    if (deadline - now() <= 0) {
      return (await poll()) || OUTCOME.EXPIRED;
    }
  }
}

module.exports = { waitForApproval, sleep, formatDuration, OUTCOME };
