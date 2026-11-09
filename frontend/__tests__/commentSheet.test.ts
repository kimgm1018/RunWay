import { sheetFit } from '../src/screens/community/comments';

// S15P31E105-596: the 댓글 sheet sizes itself from its own window, which on Android may or may not shrink
// above the keyboard depending on the phone.
const base = { screen: 800, top: 40, bottom: 24 };

test('at rest the sheet takes two thirds of its window, over the bottom inset', () => {
  expect(sheetFit({ ...base, open: 780, frame: 780, keyboard: 0 })).toEqual({
    full: 780,
    height: Math.round(780 * 0.68),
    paddingBottom: 24,
  });
  // Before the window has laid out, the screen stands in.
  expect(sheetFit({ ...base, open: 0, frame: 0, keyboard: 0 }).height).toBe(
    Math.round(800 * 0.68),
  );
});

test('a window that stays full under the keyboard lifts the comment bar by the keyboard', () => {
  const fit = sheetFit({ ...base, open: 780, frame: 780, keyboard: 300 });
  expect(fit.height).toBe(780 - 40 - 8);
  expect(fit.paddingBottom).toBe(300);
});

test('a window that shrank above the keyboard does not lift the bar a second time', () => {
  const fit = sheetFit({ ...base, open: 780, frame: 480, keyboard: 300 });
  // The sheet fills the shrunk window up to the status bar, its bar right on the keyboard.
  expect(fit.height).toBe(480 - 40 - 8);
  expect(fit.paddingBottom).toBe(0);
});
