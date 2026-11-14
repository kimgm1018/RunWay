import { tokenStore } from '../../api/tokenStore';
import { groupIntroSeen, setGroupIntroSeenForTest } from '../groupIntroSeen';

// S15P31E105-697: 그룹 탭 첫 화면 once per member on this device, kept across launches and logouts.
const signIn = (userId: number) =>
  tokenStore.save({
    userId,
    accessToken: `access-${userId}`,
    refreshToken: `refresh-${userId}`,
  });

// A new launch: nothing in memory, the keystore as it was.
const relaunch = () => setGroupIntroSeenForTest(false);

beforeEach(async () => {
  relaunch();
  await signIn(7);
});

test('a member who has not seen it gets the intro', async () => {
  expect(groupIntroSeen.peek()).toBeUndefined();
  await expect(groupIntroSeen.load()).resolves.toBe(false);
  expect(groupIntroSeen.peek()).toBe(false);
});

test('once marked, it stays seen after a relaunch', async () => {
  await groupIntroSeen.mark();
  expect(groupIntroSeen.peek()).toBe(true);
  relaunch();
  await expect(groupIntroSeen.load()).resolves.toBe(true);
});

test('each member on the device sees it once, and logging out keeps it', async () => {
  await groupIntroSeen.mark();
  await tokenStore.clear();
  await signIn(8);
  relaunch();
  await expect(groupIntroSeen.load()).resolves.toBe(false);
  await groupIntroSeen.mark();
  await signIn(7);
  relaunch();
  await expect(groupIntroSeen.load()).resolves.toBe(true);
  await signIn(8);
  await expect(groupIntroSeen.load()).resolves.toBe(true);
});

test('an unreadable store shows the intro, and the answer holds for the launch', async () => {
  const Keychain = require('react-native-keychain');
  Keychain.getGenericPassword.mockRejectedValueOnce(new Error('locked'));
  const reads = Keychain.getGenericPassword.mock.calls.length;
  await expect(groupIntroSeen.load()).resolves.toBe(false);
  await expect(groupIntroSeen.load()).resolves.toBe(false);
  expect(Keychain.getGenericPassword.mock.calls.length).toBe(reads + 1);
});

test('a failed save still keeps it away for this launch', async () => {
  const Keychain = require('react-native-keychain');
  Keychain.setGenericPassword.mockRejectedValueOnce(new Error('locked'));
  await expect(groupIntroSeen.mark()).resolves.toBeUndefined();
  await expect(groupIntroSeen.load()).resolves.toBe(true);
  relaunch();
  await expect(groupIntroSeen.load()).resolves.toBe(false);
});

test('a mark made while the store is being read is not lost', async () => {
  const Keychain = require('react-native-keychain');
  let release!: (value: unknown) => void;
  Keychain.getGenericPassword.mockImplementationOnce(
    () => new Promise(resolve => (release = resolve)),
  );
  const reading = groupIntroSeen.load();
  // Wait until the read has reached the keystore.
  while (!release) {
    await Promise.resolve();
  }
  const marking = groupIntroSeen.mark();
  release(false);
  await expect(reading).resolves.toBe(true);
  await marking;
});

test('a stored value that is not our list reads as not seen', async () => {
  const Keychain = require('react-native-keychain');
  await Keychain.setGenericPassword('group-intro', 'not json', {
    service: 'com.runway.health.group-intro-seen',
  });
  await expect(groupIntroSeen.load()).resolves.toBe(false);
  await groupIntroSeen.mark();
  relaunch();
  await expect(groupIntroSeen.load()).resolves.toBe(true);
});
