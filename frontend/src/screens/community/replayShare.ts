import { useCallback, useRef, useState, type RefObject } from 'react';
import {
  NativeModules,
  Platform,
  Share,
  findNodeHandle,
  type View,
} from 'react-native';
import ShareSheet from 'react-native-share';
import { captureRef } from 'react-native-view-shot';

// 경로 재생 공유 (S15P31E105-704): the replay as a picture, with the words and a link that opens this run's
// replay, through the share sheet. Without a picture (the capture or the image share failed) the words and the
// link go as text, as before; without a link the picture still goes.

export type ShareResult = 'image' | 'text' | 'cancelled';

// The link is made on the server when shared; past this long the picture goes without it rather than keep the
// person waiting with no sign.
export const linkWaitMs = 5000;
async function withinLinkWait(link: () => Promise<string | null>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      link(),
      new Promise<null>(resolve => {
        timer = setTimeout(() => resolve(null), linkWaitMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// Android: a copy of the window's pixels for the view, exactly as the screen shows it (the TextureView map with its
// route lines under the words); a view-drawn picture put the map's last texture over the words without the route.
// Null where it cannot (older Android, iOS), and the view-drawn picture is taken instead.
async function captureShown(view: View): Promise<string | null> {
  const module = NativeModules.RunwayScreenCapture as
    | { captureView(tag: number): Promise<string> }
    | undefined;
  const tag = findNodeHandle(view);
  if (Platform.OS !== 'android' || !module || tag == null) {
    return null;
  }
  return module.captureView(tag).catch(() => null);
}

// One frame for the screen to draw without its buttons before the picture is taken.
const nextFrame = () =>
  new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

export async function shareReplay({
  message,
  link,
  capture,
  wanted = () => true,
}: {
  message: string;
  // False once the replay was closed while the link was made: nothing is shared then.
  wanted?: () => boolean;
  // The link to send; null or a failure sends none.
  link: (() => Promise<string | null>) | null;
  // A PNG file of the replay; a failure falls back to text.
  capture: () => Promise<string>;
}): Promise<ShareResult> {
  const url = link ? await withinLinkWait(link).catch(() => null) : null;
  if (!wanted()) {
    return 'cancelled';
  }
  const text = url ? `${message}\n${url}` : message;
  let file: string | null = null;
  try {
    file = await capture();
  } catch {
    file = null;
  }
  if (file) {
    try {
      const result = await ShareSheet.open({
        url: file.startsWith('file://') ? file : `file://${file}`,
        type: 'image/png',
        message: text,
        // Closing the sheet resolves; only a real failure rejects and falls back to text.
        failOnCancel: false,
      });
      return result?.dismissedAction ? 'cancelled' : 'image';
    } catch {
      // The image could not be shared: the words still go.
    }
  }
  await Share.share({ message: text }).catch(() => undefined);
  return 'text';
}

// The replay's 공유: hides the replay's buttons for one frame, takes the picture of `shot`, then shares. A second
// press while one share is under way does nothing.
export function useReplayShare(
  shot: RefObject<View | null>,
  message: string,
  link: (() => Promise<string | null>) | null,
  visible: boolean,
  // Sets the screen up for the picture (the map replay jumps to its whole, finished route) and resolves once it is
  // drawn so.
  prepare?: () => Promise<void>,
) {
  const [capturing, setCapturing] = useState(false);
  const busy = useRef(false);
  const shown = useRef(visible);
  shown.current = visible;
  const share = useCallback(async () => {
    if (busy.current) {
      return;
    }
    busy.current = true;
    try {
      await shareReplay({
        message,
        link,
        wanted: () => shown.current,
        capture: async () => {
          setCapturing(true);
          try {
            await prepare?.();
            await nextFrame();
            await nextFrame();
            if (!shot.current) {
              throw new Error('no view');
            }
            const picture = await captureShown(shot.current);
            if (picture) {
              return picture;
            }
            return await captureRef(shot, { format: 'png', result: 'tmpfile' });
          } finally {
            setCapturing(false);
          }
        },
      });
    } finally {
      busy.current = false;
    }
  }, [link, message, prepare, shot]);
  return { capturing, share };
}
