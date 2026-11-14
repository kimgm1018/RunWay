import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { createMockRepositories, DataProvider } from '../../../data';
import { earliestDay, WeekStrip } from '../DatePicker';

// S15P31E105-776: 2.1 · 5.1 go back no further than the date picker's earliest day, and never past today.

type Screen = TestRenderer.ReactTestRenderer;

function render(value: string, today: string) {
  let screen: Screen;
  act(() => {
    screen = TestRenderer.create(
      <DataProvider repositories={createMockRepositories({ latencyMs: 0 })}>
        <WeekStrip value={value} today={today} onChange={jest.fn()} />
      </DataProvider>,
    );
  });
  return screen!;
}

// Each day of the strip's pages by its label (`11월 1일`), and whether it can be picked.
function days(screen: Screen) {
  const found = new Map<string, boolean>();
  screen.root
    .findAll(
      node =>
        typeof node.props.onPress === 'function' &&
        /^\d+월 \d+일$/.test(node.props.accessibilityLabel ?? ''),
    )
    .forEach(node =>
      found.set(
        node.props.accessibilityLabel,
        node.props.accessibilityState.disabled,
      ),
    );
  return found;
}

test('the earliest day is the first of the month 36 months before today', () => {
  expect(earliestDay('2026-11-13')).toBe('2023-11-01');
  expect(earliestDay('2026-01-31')).toBe('2023-01-01');
});

test('the week strip dims days before the earliest day', () => {
  // 2023-11-01 is a Wednesday: its Monday and Tuesday fall before the range.
  const screen = render('2023-11-01', '2026-11-13');
  const strip = days(screen);
  expect(strip.get('10월 30일')).toBe(true);
  expect(strip.get('10월 31일')).toBe(true);
  expect(strip.get('11월 1일')).toBe(false);
  expect(strip.get('11월 5일')).toBe(false);
  act(() => screen.unmount());
});

test('the week strip dims days after today', () => {
  const screen = render('2026-11-13', '2026-11-13');
  const strip = days(screen);
  expect(strip.get('11월 13일')).toBe(false);
  expect(strip.get('11월 14일')).toBe(true);
  act(() => screen.unmount());
});

// 320dp 화면에서 두 자리 날짜("10")가 "1"/"0" 두 줄로 쪼개졌다(S15P31E105-828, QA 발견). 칸이 좁아져도
// 날짜 숫자는 줄어들며 한 줄을 유지하게 한다.
test('the day number shrinks to stay on one line', () => {
  const screen = render('2026-11-10', '2026-11-13');
  const dateTexts = screen.root
    .findAllByType(Text)
    .filter(node => node.props.children === '10' || node.props.children === 10);
  expect(dateTexts.length).toBeGreaterThan(0);
  for (const node of dateTexts) {
    expect(node.props.numberOfLines).toBe(1);
    expect(node.props.adjustsFontSizeToFit).toBe(true);
    expect(node.props.minimumFontScale).toBe(0.7);
  }
  act(() => screen.unmount());
});
