import React from 'react';
import { Image, StatusBar, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { AppText, Icon, PressableScale } from '../../components';
import { fontFamily, size } from '../../theme';
import { groupLook } from './look';

// 그룹 탭 첫 화면 (S15P31E105-563, 담당자 시안 group-intro-D): shown the first time the group tab opens after the
// app starts, until 함께 달리러 가기 opens 6.0 · 6.1. Kept in memory only, so the next launch shows it again.
let seen = false;
export const groupIntroSeen = () => seen;
export const markGroupIntroSeen = () => {
  seen = true;
};
// Tests start each case with the intro seen or not as they need (jest.setup.js marks it seen).
export const setGroupIntroSeenForTest = (value: boolean) => {
  seen = value;
};

const photo = require('../../../assets/images/group-intro-photo.webp');
const ink = groupLook.navy;

export function GroupIntro({ onStart }: { onStart: () => void }) {
  const insets = useSafeAreaInsets();
  // 32 above the floating tab bar, as in the 시안 (button foot 728, bar top 760 of 844).
  const foot = Math.max(insets.bottom, size.tabBarInset) + size.tabBar + 32;
  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" />
      {/* The photo fills the top 660 of the 시안's 844, then melts into navy. */}
      <Image
        source={photo}
        resizeMode="cover"
        style={styles.photo}
        accessibilityIgnoresInvertColors
        accessible
        accessibilityLabel="강변을 함께 달리는 러너들"
      />
      <View style={styles.fade} pointerEvents="none">
        <Svg width="100%" height="100%">
          <Defs>
            <LinearGradient id="groupIntroFade" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={ink} stopOpacity={0} />
              <Stop offset="0.5" stopColor={ink} stopOpacity={0.72} />
              <Stop offset="1" stopColor={ink} stopOpacity={1} />
            </LinearGradient>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#groupIntroFade)" />
        </Svg>
      </View>
      <View style={[styles.content, { paddingBottom: foot }]}>
        <View style={styles.copy}>
          {/* The 시안 sets the title in Light; the app has no light Korean face, so Regular. */}
          <AppText style={styles.title} accessibilityRole="header">
            {'서로의 페이스를 맞추며\n함께 달려볼까요?'}
          </AppText>
          <AppText style={styles.body}>
            {
              '크루원들의 페이스를 반영한 추천 속도로\n서로의 리듬을 맞추며 달려보세요.'
            }
          </AppText>
        </View>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="함께 달리러 가기"
          onPress={onStart}
          style={styles.button}
        >
          <AppText style={styles.buttonText}>함께 달리러 가기</AppText>
          <View style={styles.buttonIcon}>
            <Icon name="arrowRight" color={groupLook.onDark} size={16} />
          </View>
        </PressableScale>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: ink },
  photo: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    width: '100%',
    height: '78%',
  },
  // From 380 to 662 of the 844: clear, 72% navy at its middle, solid navy where the photo ends.
  fade: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '45%',
    height: '34%',
  },
  content: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: 28,
  },
  copy: { gap: 12 },
  title: {
    fontFamily: fontFamily.regular,
    fontSize: 28,
    lineHeight: 38,
    letterSpacing: -0.5,
    color: '#FFFFFF',
  },
  body: {
    fontFamily: fontFamily.regular,
    fontSize: 14,
    lineHeight: 22,
    color: 'rgba(232,238,244,0.62)',
  },
  // A flat white pill on the right with a navy circle arrow, 42 under the copy.
  button: {
    alignSelf: 'flex-end',
    marginTop: 42,
    height: 54,
    minWidth: 230,
    paddingLeft: 26,
    paddingRight: 10,
    borderRadius: 27,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 24,
  },
  buttonText: {
    fontFamily: fontFamily.bold,
    fontSize: 16,
    lineHeight: 21,
    color: ink,
  },
  buttonIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
