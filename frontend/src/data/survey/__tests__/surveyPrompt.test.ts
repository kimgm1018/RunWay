import { tokenStore } from '../../api/tokenStore';
import { surveyPrompt } from '../surveyPrompt';

// S15P31E105-813 AC-6: 4.5's prompt rests 30 days after an answer or a close, 3 after 나중에, per member.
const t0 = new Date('2026-11-14T00:00:00.000Z');
const later = (days: number, ms = 0) =>
  new Date(t0.getTime() + days * 24 * 60 * 60 * 1000 + ms);

beforeEach(async () => {
  await tokenStore.save({
    userId: 7,
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
  });
});

test('nothing saved yet: the prompt is due', async () => {
  await expect(surveyPrompt.isDue(t0)).resolves.toBe(true);
});

test('an answer or a close rests it for 30 days', async () => {
  await surveyPrompt.rest('done', t0);
  await expect(surveyPrompt.isDue(t0)).resolves.toBe(false);
  await expect(surveyPrompt.isDue(later(29))).resolves.toBe(false);
  await expect(surveyPrompt.isDue(later(30, -1))).resolves.toBe(false);
  await expect(surveyPrompt.isDue(later(30))).resolves.toBe(true);
});

test('나중에 rests it for 3 days', async () => {
  await surveyPrompt.rest('later', t0);
  await expect(surveyPrompt.isDue(later(2))).resolves.toBe(false);
  await expect(surveyPrompt.isDue(later(3))).resolves.toBe(true);
});

test('each member on the device keeps their own rest', async () => {
  await surveyPrompt.rest('done', t0);
  await tokenStore.save({
    userId: 8,
    accessToken: 'access-2',
    refreshToken: 'refresh-2',
  });
  await expect(surveyPrompt.isDue(later(1))).resolves.toBe(true);
  await surveyPrompt.rest('later', t0);
  await tokenStore.save({
    userId: 7,
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
  });
  await expect(surveyPrompt.isDue(later(10))).resolves.toBe(false);
});

test('an unreadable store holds the prompt back instead of nagging', async () => {
  const Keychain = require('react-native-keychain');
  Keychain.getGenericPassword.mockRejectedValueOnce(new Error('locked'));
  await expect(surveyPrompt.isDue(t0)).resolves.toBe(false);
});

test('a stored value that is not our JSON does not keep the prompt away', async () => {
  const Keychain = require('react-native-keychain');
  await Keychain.setGenericPassword('survey-prompt', 'not json', {
    service: 'com.runway.health.survey-prompt',
  });
  await expect(surveyPrompt.isDue(t0)).resolves.toBe(true);
  await surveyPrompt.rest('later', t0);
  await expect(surveyPrompt.isDue(later(1))).resolves.toBe(false);
});
