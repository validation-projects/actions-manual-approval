jest.mock('@actions/core');
const core = require('@actions/core');
const { writeConfigurationSummary, writeResultSummary, escapeHtml } = require('../src/summary');

function mockSummary() {
  const summary = {
    addHeading: jest.fn(() => summary),
    addTable: jest.fn(() => summary),
    write: jest.fn(async () => summary),
  };
  core.summary = summary;
  return summary;
}

describe('summary', () => {
  it('writes the configuration table', async () => {
    const summary = mockSummary();
    await writeConfigurationSummary({
      waitTimer: 10,
      pollInterval: 30,
      environment: 'prod',
      defaultAction: 'approve',
      authMode: 'app',
      runId: 42,
    });
    expect(summary.addHeading).toHaveBeenCalledWith('Cancelable wait timer: configuration', 3);
    const [rows] = summary.addTable.mock.calls[0];
    expect(rows.slice(1)).toEqual([
      ['Wait timer (min)', '10'],
      ['Poll interval (s)', '30'],
      ['Environment', '<code>prod</code>'],
      ['Default action', '<code>approve</code>'],
      ['Auth mode', '<code>app</code>'],
      ['Run ID', '42'],
    ]);
    expect(summary.write).toHaveBeenCalled();
  });

  it('describes all pending environments when none is targeted', async () => {
    const summary = mockSummary();
    await writeConfigurationSummary({ waitTimer: 1, pollInterval: 30, defaultAction: 'cancel', authMode: 'user', runId: 1 });
    expect(summary.addTable.mock.calls[0][0]).toContainEqual(['Environment', 'all pending environments']);
  });

  it.each([
    [{ executedAction: 'approve', defaultAction: 'approve' }, '<code>approve</code>'],
    [{ defaultAction: 'cancel' }, 'none (configured: <code>cancel</code>)'],
    [{}, 'none'],
  ])('writes the result table (%j)', async (fields, executed) => {
    const summary = mockSummary();
    await writeResultSummary({ result: 'approved', elapsed: '1m05s', reason: 'a <b>\n& c', ...fields });
    expect(summary.addHeading).toHaveBeenCalledWith('Cancelable wait timer: result', 3);
    expect(summary.addTable.mock.calls[0][0].slice(1)).toEqual([
      ['Result', '<code>approved</code>'],
      ['Elapsed', '1m05s'],
      ['Default action executed', executed],
      ['Reason', 'a &lt;b&gt;<br>&amp; c'],
    ]);
  });

  it('does not throw when the summary cannot be written', async () => {
    const summary = mockSummary();
    summary.write.mockRejectedValue(new Error('Unable to find environment variable for $GITHUB_STEP_SUMMARY'));
    await expect(writeResultSummary({ result: 'error', elapsed: '0m00s', reason: 'x' })).resolves.toBeUndefined();
    expect(core.debug).toHaveBeenCalledWith(expect.stringContaining('GITHUB_STEP_SUMMARY'));
  });

  it('escapes HTML', () => {
    expect(escapeHtml('"<x>"')).toBe('&quot;&lt;x&gt;&quot;');
  });
});
