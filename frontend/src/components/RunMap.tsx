import React, { forwardRef } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import {
  NaverMapPathOverlay,
  NaverMapView,
  NaverMapViewRef,
} from '@mj-studio/react-native-naver-map';
import type { LngLat } from '../geo';
import { k1, palette } from '../theme';

// Kept out of components/index.ts: it loads the Naver Map native module, so screens import it directly.

export type RunMapRef = NaverMapViewRef;

type RunMapProps = {
  // A course or record as GeoJSON [longitude, latitude] points (코스 API route).
  route?: LngLat[];
  // 0–1 of the route already run, drawn in the passed colour (4.2 진행).
  progress?: number;
  // 3.1·4.2·5.2·6.x use the dark map; 2.0 by day uses the light one (DESIGN.md 2-7).
  dark?: boolean;
  // Shows the current location dot. Turn it on with location tracking, after the permission is granted.
  showLocation?: boolean;
  // A style from the NAVER Cloud Style Editor (ADR-0018: K1 day and night maps). Until the K1 styles
  // exist, the dark map falls back to Naver's night navigation map.
  customStyleId?: string;
  style?: StyleProp<ViewStyle>;
};

const toCoord = ([longitude, latitude]: LngLat) => ({ latitude, longitude });

// The course is a white line with a faint white halo, like RouteLine; the part already run fades.
const halo = 'rgba(255, 255, 255, 0.18)';
const passed = 'rgba(232, 238, 244, 0.42)';
// Only roads and places: no subway lines, bike paths or buildings competing with the course.
const layerGroups = {
  BUILDING: false,
  TRAFFIC: false,
  TRANSIT: false,
  BICYCLE: false,
  MOUNTAIN: false,
  CADASTRAL: false,
};
// The current location is a white dot (18) in a 12% white circle (DESIGN.md 2-7 지도).
// The Android side reads isVisible as required, so it is always passed with these.
const locationLook = {
  image: require('../../assets/images/location-dot.png'),
  imageWidth: 18,
  imageHeight: 18,
  circleRadius: 28,
  circleColor: 'rgba(255, 255, 255, 0.12)',
};

// The camera fits the whole route with a little margin; without one it opens on Seoul City Hall.
// The library's Region starts at the south-west corner, not the centre.
function regionFor(route: LngLat[] | undefined) {
  const points: LngLat[] = route?.length ? route : [[126.9784, 37.5666]];
  const lngs = points.map(point => point[0]);
  const lats = points.map(point => point[1]);
  const [minLng, maxLng] = [Math.min(...lngs), Math.max(...lngs)];
  const [minLat, maxLat] = [Math.min(...lats), Math.max(...lats)];
  const latitudeDelta = Math.max((maxLat - minLat) * 1.4, 0.01);
  const longitudeDelta = Math.max((maxLng - minLng) * 1.4, 0.01);
  return {
    latitude: (minLat + maxLat) / 2 - latitudeDelta / 2,
    longitude: (minLng + maxLng) / 2 - longitudeDelta / 2,
    latitudeDelta,
    longitudeDelta,
  };
}

// The shared map for 2.0·3.x·4.2·5.2·6.x (ADR-0018): the course line, and the current location dot
// once the screen turns tracking on through the ref.
export const RunMap = forwardRef<RunMapRef, RunMapProps>(function NaverRunMap(
  {
    route,
    progress = 0,
    dark = true,
    showLocation = false,
    customStyleId,
    style,
  },
  ref,
) {
  const nightFallback = dark && !customStyleId;
  return (
    <NaverMapView
      ref={ref}
      style={[{ backgroundColor: dark ? k1.night : palette.white }, style]}
      initialRegion={regionFor(route)}
      customStyleId={customStyleId}
      mapType={nightFallback ? 'Navi' : 'Basic'}
      isNightModeEnabled={nightFallback}
      layerGroups={layerGroups}
      locationOverlay={{ ...locationLook, isVisible: showLocation }}
      isExtentBoundedInKorea
      isShowLocationButton={false}
      isShowZoomControls={false}
      isShowScaleBar={false}
      isShowCompass={false}
      locale="ko"
    >
      {route && route.length >= 2 ? (
        <NaverMapPathOverlay
          coords={route.map(toCoord)}
          width={3}
          outlineWidth={2}
          color={palette.white}
          outlineColor={halo}
          passedColor={passed}
          passedOutlineColor={halo}
          progress={progress}
        />
      ) : null}
    </NaverMapView>
  );
});
