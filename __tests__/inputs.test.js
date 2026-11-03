jest.mock('@actions/core');
const core = require('@actions/core');
const { getInputs, InputError } = require('../src/inputs');

function setInputs(values) {
  core.getInput.mockImplementation((name) => values[name] || '');
}

const base = { 'wait-timer': '10', 'default-action': 'approve', 'user-token': 'ghp_x', environment: 'prod' };

describe('getInputs', () => {
  it('parses valid inputs with user-token', () => {
    setInputs(base);
    expect(getInputs()).toEqual({
      waitTimer: 10,
      waitTimerMs: 600000,
      defaultAction: 'approve',
      pollIntervalMs: 15000,
      environment: 'prod',
      auth: { mode: 'user', token: 'ghp_x' },
    });
  });

  it('parses app-token and normalizes default-action case', () => {
    setInputs({ ...base, 'user-token': '', 'app-token': 'ghs_y', 'default-action': ' Cancel ' });
    const inputs = getInputs();
    expect(inputs.auth).toEqual({ mode: 'app', token: 'ghs_y' });
    expect(inputs.defaultAction).toBe('cancel');
  });

  it('accepts app-id + app-private-key and masks the key', () => {
    setInputs({ ...base, 'user-token': '', 'app-id': '123', 'app-private-key': 'PEM' });
    expect(getInputs().auth).toEqual({ mode: 'app', appId: '123', privateKey: 'PEM' });
    expect(core.setSecret).toHaveBeenCalledWith('PEM');
  });

  it('treats empty environment as undefined', () => {
    setInputs({ ...base, environment: '' });
    expect(getInputs().environment).toBeUndefined();
  });

  it('parses a custom poll-interval', () => {
    setInputs({ ...base, 'poll-interval': '30' });
    expect(getInputs().pollIntervalMs).toBe(30000);
  });

  it.each([
    [{ 'user-token': 'a', 'app-token': 'b' }, 'mutually exclusive'],
    [{ 'user-token': '', 'app-token': '' }, 'One of "user-token" or "app-token" must be provided'],
    [{ 'user-token': 'a', 'app-id': '1', 'app-private-key': 'k' }, 'mutually exclusive'],
    [{ 'user-token': '', 'app-id': '1' }, 'must be provided together'],
    [{ 'user-token': '', 'app-token': 't', 'app-id': '1', 'app-private-key': 'k' }, 'not both'],
    [{ 'wait-timer': '' }, '"wait-timer" is required'],
    [{ 'wait-timer': '0' }, 'positive integer'],
    [{ 'wait-timer': '-5' }, 'positive integer'],
    [{ 'wait-timer': '1.5' }, 'positive integer'],
    [{ 'wait-timer': 'abc' }, 'positive integer'],
    [{ 'default-action': '' }, '"default-action" is required'],
    [{ 'default-action': 'reject' }, 'must be one of approve | cancel'],
    [{ 'poll-interval': '2' }, '"poll-interval" must be an integer between 5 and 300'],
    [{ 'user-token': '', 'app-token': 't', environment: '' }, '"environment" is required when approving through a GitHub App'],
  ])('rejects %j', (override, message) => {
    setInputs({ ...base, ...override });
    expect(() => getInputs()).toThrow(InputError);
    expect(() => getInputs()).toThrow(message);
  });

  it('does not require environment for app auth when default-action is cancel', () => {
    setInputs({ ...base, 'user-token': '', 'app-token': 't', environment: '', 'default-action': 'cancel' });
    expect(getInputs().environment).toBeUndefined();
  });

  it('reports every error at once', () => {
    setInputs({ 'wait-timer': 'x', 'default-action': 'y' });
    try {
      getInputs();
      throw new Error('should have thrown');
    } catch (error) {
      expect(error.errors).toHaveLength(3);
    }
  });
});
