const core = require('@actions/core');

const HEADER = [
  { data: 'Field', header: true },
  { data: 'Value', header: true },
];

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function code(value) {
  return `<code>${escapeHtml(value)}</code>`;
}

async function write(heading, rows) {
  try {
    await core.summary
      .addHeading(heading, 3)
      .addTable([HEADER, ...rows])
      .write();
  } catch (error) {
    core.debug(`Could not write job summary: ${error.message}`);
  }
}

/**
 * Job summary with the validated configuration, written when the watch starts.
 */
function writeConfigurationSummary({ waitTimer, pollInterval, environment, defaultAction, authMode, runId }) {
  return write('Cancelable wait timer: configuration', [
    ['Wait timer (min)', escapeHtml(waitTimer)],
    ['Poll interval (s)', escapeHtml(pollInterval)],
    ['Environment', environment ? code(environment) : 'all pending environments'],
    ['Default action', code(defaultAction)],
    ['Auth mode', code(authMode)],
    ['Run ID', escapeHtml(runId)],
  ]);
}

/**
 * Job summary with the final outcome, written on every exit path.
 */
function writeResultSummary({ result, elapsed, executedAction, defaultAction, reason }) {
  let executed = 'none';
  if (executedAction) executed = code(executedAction);
  else if (defaultAction) executed = `none (configured: ${code(defaultAction)})`;

  return write('Cancelable wait timer: result', [
    ['Result', code(result)],
    ['Elapsed', escapeHtml(elapsed)],
    ['Default action executed', executed],
    ['Reason', escapeHtml(reason).replace(/\n/g, '<br>')],
  ]);
}

module.exports = { writeConfigurationSummary, writeResultSummary, escapeHtml };
