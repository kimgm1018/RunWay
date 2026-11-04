import React from 'react';
import { Modal, ScrollView, Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import TestRenderer, { act } from 'react-test-renderer';
import { ConsentScreen } from '../src/screens/onboarding/ConsentScreen';
import {
  SignUpDraftProvider,
  useSignUpDraft,
} from '../src/screens/onboarding/SignUpDraft';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

const Stack = createNativeStackNavigator();
function Profile() {
  const { draft } = useSignUpDraft();
  return <Text>{`가입 동의 값: ${draft.healthDataAccess}`}</Text>;
}

async function render() {
  let screen: TestRenderer.ReactTestRenderer;
  await act(async () => {
    screen = TestRenderer.create(
      <SignUpDraftProvider>
        <NavigationContainer>
          <Stack.Navigator
            screenOptions={{ headerShown: false, animation: 'none' }}
          >
            <Stack.Screen name="Consent" component={ConsentScreen} />
            <Stack.Screen name="ProfileBasic" component={Profile} />
          </Stack.Navigator>
        </NavigationContainer>
      </SignUpDraftProvider>,
    );
  });
  return screen!;
}

function control(screen: TestRenderer.ReactTestRenderer, label: string) {
  return screen.root
    .findAll(
      node =>
        node.props.accessibilityLabel === label &&
        typeof node.props.onPress === 'function',
    )
    .slice(-1)[0];
}

async function press(screen: TestRenderer.ReactTestRenderer, label: string) {
  await act(async () => control(screen, label).props.onPress());
}

function text(node: TestRenderer.ReactTestInstance) {
  return node
    .findAllByType(Text)
    .flatMap(item => [item.props.children].flat())
    .join(' ');
}

test.each([
  ['서비스 이용약관', '제1조 목적', '제7조 약관의 변경'],
  ['개인정보 수집·이용', '1. 수집하는 항목', '4. 동의 거부와 권리 행사'],
  ['위치 정보 수집·이용', '1. 수집하는 위치 정보', '4. 동의 거부와 수집 중지'],
  ['건강 데이터 이용', '1. 수집하는 건강 데이터', '5. 동의 거부와 철회'],
])(
  '%s opens the complete scrollable terms without giving consent',
  async (title, first, last) => {
    const screen = await render();
    await press(screen, `${title} 보기`);
    const modal = screen.root.findByType(Modal);
    const body = modal.findByType(ScrollView);
    expect(text(body)).toContain(first);
    expect(text(body)).toContain(last);
    expect(text(body)).not.toContain('정책이 확정되면');
    await press(screen, '확인');
    expect(control(screen, '동의하고 가입하기').props.disabled).toBe(true);
    expect(control(screen, '전체 동의').props.accessibilityState.checked).toBe(
      false,
    );
    await act(async () => screen.unmount());
  },
);

test('Android back closes the terms and keeps the checked consents', async () => {
  const screen = await render();
  await press(screen, '[필수] 서비스 이용약관');
  await press(screen, '건강 데이터 이용 보기');
  expect(text(screen.root.findByType(Modal))).toContain('거부해도 회원가입');
  await act(async () => screen.root.findByType(Modal).props.onRequestClose());
  expect(
    control(screen, '[필수] 서비스 이용약관').props.accessibilityState.checked,
  ).toBe(true);
  expect(
    control(screen, '[선택] 건강 데이터 이용').props.accessibilityState.checked,
  ).toBe(false);
  await act(async () => screen.unmount());
});

test.each([false, true])(
  'required consents allow joining with health agreement %s',
  async health => {
    const screen = await render();
    await press(screen, '전체 동의');
    await press(screen, '전체 동의');
    expect(control(screen, '동의하고 가입하기').props.disabled).toBe(true);
    await press(screen, '[필수] 서비스 이용약관');
    await press(screen, '[필수] 개인정보 수집·이용');
    expect(control(screen, '동의하고 가입하기').props.disabled).toBe(true);
    await press(screen, '[필수] 위치 정보 수집·이용');
    if (health) {
      await press(screen, '[선택] 건강 데이터 이용');
    }
    expect(control(screen, '동의하고 가입하기').props.disabled).toBe(false);
    await press(screen, '동의하고 가입하기');
    expect(text(screen.root)).toContain(
      `가입 동의 값: ${health ? 'AGREEE' : 'DISAGREE'}`,
    );
    await act(async () => screen.unmount());
  },
);
