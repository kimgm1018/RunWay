import React, { useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  Platform,
  StyleSheet,
  View,
  type KeyboardEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

// Keeps footer buttons right above the keyboard (S15P31E105-473). The app targets SDK 36, so Android draws
// edge-to-edge and no longer shrinks the window for the keyboard (adjustResize does nothing). KeyboardAvoidingView
// measures itself against its parent, so in a sheet that starts mid-screen it lifts far too little. This box
// measures itself in the window and lifts its content by exactly the part the keyboard covers; where the window
// still shrinks (older Android) nothing is covered and the lift stays 0.
export function KeyboardLift({
  children,
  style,
  pointerEvents,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  // 'box-none' when it lies over a map, so touches outside the sheet still reach the map.
  pointerEvents?: 'box-none';
}) {
  const box = useRef<View>(null);
  const [lift, setLift] = useState(0);
  useEffect(() => {
    const showEvent =
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent =
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const shown = Keyboard.addListener(showEvent, (event: KeyboardEvent) =>
      box.current?.measureInWindow((_x, y, _width, height) =>
        setLift(Math.max(0, y + height - event.endCoordinates.screenY)),
      ),
    );
    const hidden = Keyboard.addListener(hideEvent, () => setLift(0));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);
  // The inner box shrinks by a margin, so footers laid out in the flow and footers pinned with
  // position: 'absolute' both move up.
  return (
    <View ref={box} style={[styles.fill, style]} pointerEvents={pointerEvents}>
      <View
        style={[styles.fill, { marginBottom: lift }]}
        pointerEvents={pointerEvents}
      >
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
