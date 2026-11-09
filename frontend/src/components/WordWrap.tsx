import React from 'react';
import { StyleSheet, View, type StyleProp, type TextStyle } from 'react-native';
import { AppText } from './AppText';

// Korean that wraps between words, not letters. Android breaks Korean between any two letters (보세 / 요), so each
// word is its own text in a wrapping row and a line can only end between words; the space is the row's gap, about a
// space's width at the text's size. The whole line stays one string for the screen reader.
export function WordWrap({
  text,
  style,
  fontSize,
}: {
  text: string;
  style: StyleProp<TextStyle>;
  // The text's size, for the width of the space between words.
  fontSize: number;
}) {
  return (
    <View
      style={[styles.row, { columnGap: Math.round(fontSize * 0.28) }]}
      accessible
      accessibilityLabel={text}
    >
      {text.split(' ').map((word, index) => (
        // One line each: a word measured in what is left of a row can be laid out as two lines' height.
        <AppText key={`${index}-${word}`} style={style} numberOfLines={1}>
          {word}
        </AppText>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start' },
});
