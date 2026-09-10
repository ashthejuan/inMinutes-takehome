import 'package:flutter/foundation.dart';

/// Backend base URL for Phase 0.
/// Override: `flutter run --dart-define=API_BASE_URL=http://192.168.x.x:3000`
String get apiBaseUrl {
  const fromEnv = String.fromEnvironment('API_BASE_URL');
  if (fromEnv.isNotEmpty) {
    return fromEnv;
  }
  if (kIsWeb) {
    return 'http://localhost:3000';
  }
  // Android emulator loopback to host machine.
  return 'http://10.0.2.2:3000';
}
