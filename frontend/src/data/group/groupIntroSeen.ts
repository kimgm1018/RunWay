import * as Keychain from 'react-native-keychain';
import { tokenStore } from '../api/tokenStore';

// 그룹 탭 첫 화면 (GroupIntro) once per member on this device (S15P31E105-697). Policy: each account sees it once and
// keeps that through logout; a new device, or a reinstall that clears the keystore, shows it again. The keystore is
// the one store the app already has (see survey/surveyPrompt.ts). The server does not keep this.
const service = 'com.runway.health.group-intro-seen';

// Mock data has no member id; one shared slot is enough there.
const memberKey = () => String(tokenStore.current()?.userId ?? 'local');

// What this launch already knows per member, so the tab does not wait on the keystore twice and an answer stays the
// same for the whole launch.
let known: Record<string, boolean> = {};
let forced: boolean | undefined;
let writes: Promise<unknown> = Promise.resolve();

// A keystore failure throws; a stored value that is not our list reads as empty.
async function read(): Promise<string[]> {
  const saved = await Keychain.getGenericPassword({ service });
  if (!saved) return [];
  try {
    const value = JSON.parse(saved.password);
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

export const groupIntroSeen = {
  // The answer when this launch already has it, otherwise undefined.
  peek(): boolean | undefined {
    return forced ?? known[memberKey()];
  },
  // Whether the member has seen the intro. An unreadable store says no, so the intro shows rather than the tab
  // guessing; 함께 달리러 가기 then works as usual.
  async load(): Promise<boolean> {
    const ready = groupIntroSeen.peek();
    if (ready !== undefined) return ready;
    const key = memberKey();
    await writes.catch(() => {});
    let seen = false;
    try {
      seen = (await read()).includes(key);
    } catch {
      seen = false;
    }
    // A mark made while reading wins.
    known[key] = known[key] || seen;
    return known[key];
  },
  // Marks it seen for this launch at once and saves it. A failed save only means the next launch shows it again.
  mark(): Promise<void> {
    const key = memberKey();
    known[key] = true;
    const operation = writes
      .catch(() => {})
      .then(async () => {
        let saved: string[] = [];
        try {
          saved = await read();
        } catch {
          saved = [];
        }
        if (saved.includes(key)) return;
        await Keychain.setGenericPassword(
          'group-intro',
          JSON.stringify([...saved, key]),
          { service },
        );
      })
      .catch(() => {});
    writes = operation;
    return operation;
  },
};

// Tests: true opens the group tab straight onto 6.0 for everyone (jest.setup.js); false forgets what this launch knows,
// as a fresh launch does, and reads the keystore again.
export const setGroupIntroSeenForTest = (value: boolean) => {
  forced = value ? true : undefined;
  known = {};
};
