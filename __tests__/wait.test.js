jest.mock('@actions/core');
const core = require('@actions/core');
const { waitForApproval, sleep, formatDuration, OUTCOME } = require('../src/wait');

describe('waitForApproval', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const opts = (check, extra = {}) => ({ durationMs: 60000, intervalMs: 15000, check, now: Date.now, ...extra });

  it('returns approved immediately when already approved', async () => {
    const check = jest.fn().mockResolvedValue('approved');
    await expect(waitForApproval(opts(check))).resolves.toBe(OUTCOME.APPROVED);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('stops polling as soon as an approval is detected', async () => {
    const check = jest.fn().mockResolvedValueOnce('pending').mockResolvedValueOnce('pending').mockResolvedValue('approved');
    const promise = waitForApproval(opts(check));
    await jest.advanceTimersByTimeAsync(30000);
    await expect(promise).resolves.toBe(OUTCOME.APPROVED);
    expect(check).toHaveBeenCalledTimes(3);
  });

  it('returns rejected when a reviewer rejects', async () => {
    const check = jest.fn().mockResolvedValueOnce('pending').mockResolvedValue('rejected');
    const promise = waitForApproval(opts(check));
    await jest.advanceTimersByTimeAsync(15000);
    await expect(promise).resolves.toBe(OUTCOME.REJECTED);
  });

  it('expires after the wait timer, with a final check at the deadline', async () => {
    const check = jest.fn().mockResolvedValue('pending');
    const promise = waitForApproval(opts(check));
    await jest.advanceTimersByTimeAsync(60000);
    await expect(promise).resolves.toBe(OUTCOME.EXPIRED);
    // t=0, 15, 30, 45 and the final check at 60s
    expect(check).toHaveBeenCalledTimes(5);
  });

  it('honours an approval detected in the final check', async () => {
    const check = jest.fn().mockImplementation(async () => (Date.now() >= start + 60000 ? 'approved' : 'pending'));
    const start = Date.now();
    const promise = waitForApproval(opts(check));
    await jest.advanceTimersByTimeAsync(60000);
    await expect(promise).resolves.toBe(OUTCOME.APPROVED);
  });

  it('keeps polling when a check throws', async () => {
    const check = jest.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue('approved');
    const promise = waitForApproval(opts(check));
    await jest.advanceTimersByTimeAsync(15000);
    await expect(promise).resolves.toBe(OUTCOME.APPROVED);
    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('boom'), { title: 'Approval check' });
  });

  it('returns aborted when a successful check finishes after the signal is aborted', async () => {
    const controller = new AbortController();
    let finishCheck;
    const check = jest.fn(() => new Promise((resolve) => {
      finishCheck = resolve;
    }));
    const promise = waitForApproval(opts(check, { signal: controller.signal }));

    controller.abort();
    finishCheck('approved');

    await expect(promise).resolves.toBe(OUTCOME.ABORTED);
  });

  it('returns aborted when the final deadline check fails after the signal is aborted', async () => {
    const controller = new AbortController();
    let failFinalCheck;
    const check = jest
      .fn()
      .mockResolvedValueOnce('pending')
      .mockImplementationOnce(() => new Promise((_resolve, reject) => {
        failFinalCheck = reject;
      }));
    const promise = waitForApproval(opts(check, { durationMs: 100, intervalMs: 100, signal: controller.signal }));

    await jest.advanceTimersByTimeAsync(100);
    controller.abort();
    failFinalCheck(new Error('request failed'));

    await expect(promise).resolves.toBe(OUTCOME.ABORTED);
  });

  it('can be aborted with an AbortController', async () => {
    const controller = new AbortController();
    const check = jest.fn().mockResolvedValue('pending');
    const promise = waitForApproval(opts(check, { signal: controller.signal }));
    await jest.advanceTimersByTimeAsync(5000);
    controller.abort();
    await expect(promise).resolves.toBe(OUTCOME.ABORTED);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('returns aborted without polling when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const check = jest.fn();
    await expect(waitForApproval(opts(check, { signal: controller.signal }))).resolves.toBe(OUTCOME.ABORTED);
    expect(check).not.toHaveBeenCalled();
  });
});

describe('sleep', () => {
  it('resolves early when aborted', async () => {
    jest.useFakeTimers();
    const controller = new AbortController();
    const promise = sleep(100000, controller.signal);
    controller.abort();
    await expect(promise).resolves.toBeUndefined();
    jest.useRealTimers();
  });
});

describe('formatDuration', () => {
  it('formats minutes and seconds', () => {
    expect(formatDuration(125000)).toBe('2m05s');
    expect(formatDuration(-1)).toBe('0m00s');
  });
});
