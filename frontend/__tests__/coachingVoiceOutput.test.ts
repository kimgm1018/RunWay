import { NativeModules, Platform } from 'react-native';
import {
  speakCoaching,
  stopCoaching,
} from '../src/screens/run/coachingVoiceOutput';

// S15P31E105-579: TTS가 없거나 실패해도 러닝을 막지 않는다.

const speak = jest.fn();
const stop = jest.fn();
const os = Platform.OS;

beforeEach(() => {
  speak.mockReset();
  stop.mockReset();
  NativeModules.CoachingVoice = { speak, stop };
  Platform.OS = 'android';
});

afterAll(() => {
  delete NativeModules.CoachingVoice;
  Platform.OS = os;
});

test('hands the sentence to the phone and reports whether it is read', async () => {
  speak.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  await expect(speakCoaching('조금 빨라요. 6분 페이스로 맞춰 주세요.')).resolves.toBe(true);
  expect(speak).toHaveBeenCalledWith('조금 빨라요. 6분 페이스로 맞춰 주세요.');
  // 엔진이나 한국어 음성이 없으면 false.
  await expect(speakCoaching('좋아요. 지금 페이스를 유지하세요.')).resolves.toBe(false);
});

test('a failing engine or a blank sentence is not read and does not throw', async () => {
  speak.mockRejectedValueOnce(new Error('engine'));
  await expect(speakCoaching('심박이 너무 높아요.')).resolves.toBe(false);
  await expect(speakCoaching('  ')).resolves.toBe(false);
  expect(speak).toHaveBeenCalledTimes(1);
});

test('off Android or without the module nothing is spoken', async () => {
  Platform.OS = 'ios';
  await expect(speakCoaching('심박이 너무 높아요.')).resolves.toBe(false);
  stopCoaching();
  Platform.OS = 'android';
  delete NativeModules.CoachingVoice;
  await expect(speakCoaching('심박이 너무 높아요.')).resolves.toBe(false);
  expect(() => stopCoaching()).not.toThrow();
  expect(speak).not.toHaveBeenCalled();
  expect(stop).not.toHaveBeenCalled();
});

test('stop cuts the sentence and survives a failing module', () => {
  stopCoaching();
  expect(stop).toHaveBeenCalledTimes(1);
  stop.mockImplementationOnce(() => {
    throw new Error('gone');
  });
  expect(() => stopCoaching()).not.toThrow();
});
