import React from 'react';
import { Text, TextInput } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { createMockRepositories, DataProvider } from '../../../data';
import { DataError } from '../../../data/errors';
import { ToastProvider } from '../../../components';
import { PostWriteScreen } from '../PostWriteScreen';

// S15P31E105-803 리뷰 A-2: 7.3 게시가 400 INVALID_REGION으로 실패해도 화면은 그대로 남고 쓴 글이 지워지지 않는다. 지역은 기록
// 출발점에서 정해져(지도 아래 '지역:') 화면에서 고를 곳이 없으므로, 안내는 글이 남아 있다는 것만 알린다.

const mockNavigation = { goBack: jest.fn(), navigate: jest.fn(), replace: jest.fn() };

jest.mock('@react-navigation/native', () => {
  const ReactActual = jest.requireActual('react');
  return {
    useNavigation: () => mockNavigation,
    useRoute: () => ({ params: { recordId: null } }),
    useFocusEffect: (effect: () => void | (() => void)) =>
      ReactActual.useEffect(effect, [effect]),
    useIsFocused: () => true,
  };
});
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

type Screen = TestRenderer.ReactTestRenderer;

const texts = (screen: Screen) =>
  screen.root
    .findAllByType(Text)
    .flatMap(node => [node.props.children].flat())
    .filter(child => typeof child === 'string')
    .join(' ');

const settle = () =>
  act(() => new Promise<void>(resolve => setTimeout(resolve, 30)));

test('지역 오류로 게시가 실패해도 쓴 글과 화면이 그대로 남는다', async () => {
  const repositories = createMockRepositories({ latencyMs: 0 });
  const create = jest.fn(async () => {
    throw new DataError(
      'INVALID_REGION',
      '존재하지 않는 지역 코드입니다.',
      null,
      400,
    );
  });
  repositories.community.create = create;
  let screen!: Screen;
  await act(async () => {
    screen = TestRenderer.create(
      <DataProvider repositories={repositories}>
        <ToastProvider>
          <PostWriteScreen />
        </ToastProvider>
      </DataProvider>,
    );
  });
  await settle();

  const input = () =>
    screen.root.find(
      node =>
        node.type === TextInput && node.props.accessibilityLabel === '글 내용',
    );
  await act(async () => input().props.onChangeText('오늘 해변 러닝 기록'));
  const submit = screen.root.find(
    node =>
      node.props.accessibilityLabel === '게시' &&
      typeof node.props.onPress === 'function',
  );
  await act(async () => submit.props.onPress());
  await settle();

  expect(create).toHaveBeenCalledTimes(1);
  expect(create.mock.calls[0]).toEqual([
    expect.anything(),
    expect.objectContaining({ body: '오늘 해변 러닝 기록' }),
  ]);
  expect(texts(screen)).toContain(
    '이 기록의 지역을 확인하지 못해 게시하지 못했어요. 쓴 글은 그대로 있어요',
  );
  expect(input().props.value).toBe('오늘 해변 러닝 기록');
  expect(mockNavigation.goBack).not.toHaveBeenCalled();
  expect(mockNavigation.replace).not.toHaveBeenCalled();
  expect(mockNavigation.navigate).not.toHaveBeenCalled();
  await act(async () => screen.unmount());
});
