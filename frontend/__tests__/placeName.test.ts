import { NativeModules, Platform } from 'react-native';
import { placeNameOf } from '../src/data/placeName';

const nameOf = jest.fn();
const os = Platform.OS;

beforeEach(() => {
  nameOf.mockReset();
  NativeModules.PlaceName = { nameOf };
  Platform.OS = 'android';
});

afterAll(() => {
  delete NativeModules.PlaceName;
  Platform.OS = os;
});

test('asks the phone with latitude first and trims the name', async () => {
  nameOf.mockResolvedValue(' 해운대구 우동 ');
  await expect(placeNameOf([129.1189, 35.1532])).resolves.toBe('해운대구 우동');
  expect(nameOf).toHaveBeenCalledWith(35.1532, 129.1189);
});

test('a blank answer or a failure is no name', async () => {
  nameOf.mockResolvedValueOnce('  ').mockRejectedValueOnce(new Error('x'));
  await expect(placeNameOf([129, 35])).resolves.toBeNull();
  await expect(placeNameOf([129, 35])).resolves.toBeNull();
});

test('off Android or without the module there is no name', async () => {
  Platform.OS = 'ios';
  await expect(placeNameOf([129, 35])).resolves.toBeNull();
  Platform.OS = 'android';
  delete NativeModules.PlaceName;
  await expect(placeNameOf([129, 35])).resolves.toBeNull();
  expect(nameOf).not.toHaveBeenCalled();
});
