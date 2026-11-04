import { DataError } from '../../data/errors';
import { retryPendingLogouts, revokeOnServer } from '../serverLogout';

const offline = () =>
  Promise.reject(new DataError('NETWORK_ERROR', '연결 없음'));
const refused = () =>
  Promise.reject(new DataError('VALIDATION_ERROR', '형식 오류', null, 400));

describe('serverLogout', () => {
  it('reports a confirmed revoke and keeps nothing for later', async () => {
    const logout = jest.fn().mockResolvedValue(undefined);
    await expect(revokeOnServer(logout, 'refresh-1')).resolves.toBe(true);
    await retryPendingLogouts(logout);
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('keeps a token whose U03 got no answer and sends it at the next launch', async () => {
    await expect(revokeOnServer(jest.fn(offline), 'refresh-1')).resolves.toBe(
      false,
    );
    const logout = jest.fn().mockResolvedValue(undefined);
    await retryPendingLogouts(logout);
    expect(logout).toHaveBeenCalledWith('refresh-1');
    // Sent once, so a later launch has nothing left.
    await retryPendingLogouts(logout);
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('keeps a token that fails again, and drops one the server refuses', async () => {
    await revokeOnServer(jest.fn(offline), 'refresh-1');
    await revokeOnServer(jest.fn(offline), 'refresh-2');
    await retryPendingLogouts(
      jest.fn((token: string) =>
        token === 'refresh-1' ? offline() : refused(),
      ),
    );
    const logout = jest.fn().mockResolvedValue(undefined);
    await retryPendingLogouts(logout);
    expect(logout.mock.calls).toEqual([['refresh-1']]);
  });

  it('does not keep a token the server refused as malformed', async () => {
    await expect(revokeOnServer(jest.fn(refused), 'bad')).resolves.toBe(false);
    const logout = jest.fn().mockResolvedValue(undefined);
    await retryPendingLogouts(logout);
    expect(logout).not.toHaveBeenCalled();
  });
});
