import React from 'react';
import { StyleSheet, TextInput } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { TextField } from '../TextField';
import { ThemeProvider } from '../../theme';

test('Android caret follows the TextField text line height', () => {
  let tree: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <ThemeProvider>
        <TextField accessibilityLabel="장소·주소 검색" placeholder="장소·주소 검색" />
      </ThemeProvider>,
    );
  });
  const input = tree!.root.findByType(TextInput);
  expect(StyleSheet.flatten(input.props.style)).toMatchObject({
    fontSize: 15,
    lineHeight: 20,
    includeFontPadding: false,
    textAlignVertical: 'center',
  });
});
