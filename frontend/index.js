/**
 * @format
 */

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
// 러닝 중 화면이 꺼져도 JS 타이머가 돌게 하는 빈 작업(S15P31E105-533). 네이티브 러닝 서비스가 켜고 끈다(RunTimersKeeper).
// 스스로 끝나지 않으며, 러닝 서비스가 멈출 때 네이티브가 작업을 끝낸다.
AppRegistry.registerHeadlessTask('RunWayKeepTimers', () => () => new Promise(() => undefined));
