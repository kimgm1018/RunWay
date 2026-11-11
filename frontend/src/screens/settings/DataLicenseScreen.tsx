import React from 'react';
import {
  Linking,
  NativeModules,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, Backdrop, Icon, useToast } from '../../components';
import { BackButton } from '../../components/BackButton';
import { fontFamily } from '../../theme';
import { settingsLook } from './SettingsScreen';

export const osmCopyrightUrl = 'https://www.openstreetmap.org/copyright';

// RunwayNaverMapLegal (Android): opens the NAVER Map SDK's own 법적 공지 and 오픈소스 라이선스 screens, as the SDK's
// terms ask every app to offer. iOS has no module yet, so the 네이버 지도 part is left out there.
type NaverMapLegal = {
  showLegalNotice: () => Promise<void>;
  showOpenSourceLicense: () => Promise<void>;
};

const naverMapLegal = () =>
  NativeModules.RunwayNaverMapLegal as NaverMapLegal | undefined;

// A row of 60 between white lines that opens something, with a › at the end (8.1b's rows).
function LinkRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <AppText style={styles.rowText}>{label}</AppText>
      <Icon name="forward" color={settingsLook.sub} size={18} />
    </Pressable>
  );
}

// 8.1c 데이터 라이선스 (S15P31E105-612): where the map data on RunWay comes from. The course cards' map images
// (roads, buildings, water, green) are rendered from OpenStreetMap (ODbL), so its notice and copyright page are here; the bigger maps are NAVER's,
// whose legal notice and open source licences open in the SDK's own screens (Android).
export function DataLicenseScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const naver = naverMapLegal();

  const openCopyright = async () => {
    try {
      await Linking.openURL(osmCopyrightUrl);
    } catch {
      toast('링크를 열지 못했어요. 잠시 후 다시 시도해 주세요');
    }
  };
  const openNaver = async (show: () => Promise<void>) => {
    try {
      await show();
    } catch {
      toast('화면을 열지 못했어요. 잠시 후 다시 시도해 주세요');
    }
  };

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" />
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Backdrop tail />
      </View>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <BackButton onPress={() => navigation.goBack()} />
        <AppText style={styles.title} accessibilityRole="header">
          데이터 라이선스
        </AppText>
      </View>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 40 },
        ]}
      >
        <AppText style={styles.section} accessibilityRole="header">
          OpenStreetMap
        </AppText>
        <AppText style={styles.notice}>Map data from OpenStreetMap</AppText>
        <AppText style={styles.body}>
          코스 썸네일의 지도(도로·건물·물·녹지)는 OpenStreetMap 기여자의
          데이터(ODbL)로 그립니다.
        </AppText>
        <View style={styles.list}>
          <LinkRow label="OpenStreetMap 저작권" onPress={openCopyright} />
        </View>

        {naver ? (
          <>
            <AppText style={styles.section} accessibilityRole="header">
              네이버 지도
            </AppText>
            <AppText style={styles.body}>
              러닝·코스 지도는 NAVER 지도 SDK로 보여 줍니다.
            </AppText>
            <View style={styles.list}>
              <LinkRow
                label="법적 공지"
                onPress={() => openNaver(() => naver.showLegalNotice())}
              />
              <LinkRow
                label="오픈소스 라이선스"
                onPress={() => openNaver(() => naver.showOpenSourceLicense())}
              />
            </View>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  pressed: { opacity: 0.6 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  title: {
    fontFamily: fontFamily.bold,
    fontSize: 22,
    lineHeight: 30,
    letterSpacing: -0.5,
    color: settingsLook.ink,
  },
  content: { paddingHorizontal: 24 },
  section: {
    marginTop: 24,
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 20,
    letterSpacing: -0.2,
    color: settingsLook.label,
  },
  notice: {
    marginTop: 10,
    fontFamily: fontFamily.bold,
    fontSize: 16.5,
    lineHeight: 22,
    letterSpacing: -0.3,
    color: settingsLook.ink,
  },
  body: {
    marginTop: 6,
    fontFamily: fontFamily.medium,
    fontSize: 13.5,
    lineHeight: 20,
    letterSpacing: -0.2,
    color: settingsLook.sub,
  },
  // 8.1b's rows of 60 between white lines.
  list: {
    marginTop: 12,
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.9)',
  },
  row: {
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
    borderBottomWidth: 1,
    borderColor: 'rgba(255,255,255,0.9)',
  },
  rowText: {
    fontFamily: fontFamily.medium,
    fontSize: 16,
    lineHeight: 22,
    letterSpacing: -0.3,
    color: settingsLook.ink,
  },
});
