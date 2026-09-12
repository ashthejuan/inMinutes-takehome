/// Backend base URL.
/// Default is the Fly.io deployment; override for local dev with:
/// `flutter run --dart-define=API_BASE_URL=http://localhost:3000`
/// (emulator: `http://10.0.2.2:3000`).
String get apiBaseUrl {
  const fromEnv = String.fromEnvironment('API_BASE_URL');
  if (fromEnv.isNotEmpty) {
    return fromEnv;
  }
  return 'https://inminutes-takehome.fly.dev';
}
