import * as Keychain from 'react-native-keychain';
import { tokenStore } from '../api/tokenStore';

// 4.5's 만족도 조사 prompt (S15P31E105-813): when it may show again, per member, on this device. The keystore is the one
// store the app already has (see music/withSavedMusic.ts). The server does not decide this.
const service = 'com.runway.health.survey-prompt';
const dayMs = 24 * 60 * 60 * 1000;

// 제출·닫기 keep it away for 30 days, 나중에 for 3 (docs/design/api/satisfaction-surveys.md).
export const surveyPromptRest = { done: 30, later: 3 } as const;
export type SurveyPromptOutcome = keyof typeof surveyPromptRest;

type Saved = Record<string, string>;

// Mock data has no member id; one shared slot is enough there.
const memberKey = () => String(tokenStore.current()?.userId ?? 'local');

let writes: Promise<unknown> = Promise.resolve();

// A keystore failure throws; a stored value that is not our JSON reads as empty, so a broken entry cannot keep the
// prompt away for good (the next rest overwrites it).
async function read(): Promise<Saved> {
  const saved = await Keychain.getGenericPassword({ service });
  if (!saved) return {};
  try {
    const value = JSON.parse(saved.password);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Saved)
      : {};
  } catch {
    return {};
  }
}

export const surveyPrompt = {
  // True when nothing holds the prompt back. An unreadable store says no: a missed prompt is better than a nagging one.
  async isDue(now: Date = new Date()): Promise<boolean> {
    await writes.catch(() => {});
    try {
      const next = (await read())[memberKey()];
      if (next === undefined) return true;
      const at = Date.parse(next);
      return Number.isNaN(at) || now.getTime() >= at;
    } catch {
      return false;
    }
  },
  // Holds the prompt back for the outcome's rest from now. A failed write only means it may show again sooner.
  rest(outcome: SurveyPromptOutcome, now: Date = new Date()): Promise<void> {
    const key = memberKey();
    const until = new Date(
      now.getTime() + surveyPromptRest[outcome] * dayMs,
    ).toISOString();
    const operation = writes
      .catch(() => {})
      .then(async () => {
        let saved: Saved = {};
        try {
          saved = await read();
        } catch {
          saved = {};
        }
        await Keychain.setGenericPassword(
          'survey-prompt',
          JSON.stringify({ ...saved, [key]: until }),
          { service },
        );
      })
      .catch(() => {});
    writes = operation;
    return operation;
  },
};
