import React from 'react';
import { Text, TextInput } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import {
  CodeInput,
  type CodeInputStatus,
} from '../src/screens/onboarding/CodeInput';
import { CodeInputDemo } from '../src/screens/onboarding/CodeInputDemo';

// S15P31E105-646: 인증번호 6칸 입력. 테스트는 동작 줄이기가 켜져 있어(jest.setup.js) 움직임 없이 마지막 상태를 본다.

type Screen = TestRenderer.ReactTestRenderer;

function texts(screen: Screen) {
  return screen.root
    .findAllByType(Text)
    .flatMap(node => [node.props.children].flat())
    .filter(child => typeof child === 'string' || typeof child === 'number')
    .join(' ');
}

function input(screen: Screen) {
  return screen.root.findByType(TextInput);
}

// 타일은 너비를 재야 그려진다.
async function layout(screen: Screen) {
  const root = screen.root.findAll(node => typeof node.props.onLayout === 'function')[0];
  await act(async () => {
    root.props.onLayout({ nativeEvent: { layout: { width: 360, height: 80 } } });
  });
}

async function render(props: {
  value?: string;
  status?: CodeInputStatus;
  error?: string | null;
  onChangeText?: (text: string) => void;
  onSuccess?: () => void;
}) {
  let screen: Screen;
  const element = (next: typeof props) => (
    <CodeInput
      value={next.value ?? ''}
      status={next.status ?? 'entering'}
      error={next.error ?? null}
      onChangeText={next.onChangeText ?? (() => undefined)}
      onSuccess={next.onSuccess}
    />
  );
  await act(async () => {
    screen = TestRenderer.create(element(props));
  });
  await layout(screen!);
  const update = async (next: typeof props) => {
    await act(async () => {
      screen.update(element({ ...props, ...next }));
    });
  };
  return { screen: screen!, update };
}

test('one hidden numeric input takes the code and the tiles show its digits', async () => {
  const onChangeText = jest.fn();
  const { screen } = await render({ value: '482', onChangeText });
  const field = input(screen);
  expect(field.props.accessibilityLabel).toBe('인증번호 6자리');
  expect(field.props.keyboardType).toBe('number-pad');
  expect(field.props.autoComplete).toBe('sms-otp');
  expect(field.props.textContentType).toBe('oneTimeCode');
  expect(field.props.maxLength).toBe(6);
  expect(texts(screen)).toContain('4 8 2');
  // 숫자가 아닌 글자는 빼고 6자리까지만 넘긴다(붙여넣기).
  await act(async () => field.props.onChangeText('48-29 13 77'));
  expect(onChangeText).toHaveBeenLastCalledWith('482913');
  await act(async () => screen.unmount());
});

test('checking hides the error, success shows the mark and calls onSuccess once', async () => {
  const onSuccess = jest.fn();
  const { screen, update } = await render({
    value: '123456',
    status: 'error',
    error: '인증번호가 일치하지 않아요',
    onSuccess,
  });
  expect(texts(screen)).toContain('인증번호가 일치하지 않아요');
  await update({ status: 'verifying', error: null });
  expect(texts(screen)).not.toContain('인증번호가 일치하지 않아요');
  expect(input(screen).props.editable).toBe(false);
  await update({ status: 'success' });
  expect(texts(screen)).toContain('인증 완료');
  await update({ status: 'success', value: '123456' });
  expect(onSuccess).toHaveBeenCalledTimes(1);
  await act(async () => screen.unmount());
});

test('a locked code cannot be typed and keeps its message', async () => {
  const { screen } = await render({
    status: 'locked',
    error: '인증번호를 5회 틀렸어요. 인증번호를 다시 받아 주세요.',
  });
  expect(input(screen).props.editable).toBe(false);
  expect(texts(screen)).toContain('인증번호를 5회 틀렸어요');
  await act(async () => screen.unmount());
});

test('the demo accepts only 482913, and its message chip fills the code', async () => {
  jest.useFakeTimers();
  let screen: Screen;
  await act(async () => {
    screen = TestRenderer.create(<CodeInputDemo />);
  });
  await layout(screen!);
  await act(async () => input(screen).props.onChangeText('111111'));
  await act(async () => {
    jest.advanceTimersByTime(1300);
  });
  expect(texts(screen!)).toContain('인증번호가 일치하지 않아요');
  expect(input(screen!).props.value).toBe('');
  const chip = screen!.root.find(
    node => node.props.accessibilityLabel === '메시지에서 받은 인증번호 482913 넣기',
  );
  await act(async () => chip.props.onPress());
  await act(async () => {
    jest.advanceTimersByTime(1300);
  });
  expect(texts(screen!)).toContain('인증 완료');
  await act(async () => screen!.unmount());
  jest.useRealTimers();
});
