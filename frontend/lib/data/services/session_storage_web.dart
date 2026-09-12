// ignore: avoid_web_libraries_in_flutter
import 'dart:html' as html;

class SessionStorageImpl {
  static const _key = 'inminutes_active_session';

  static String? loadRaw() {
    try {
      return html.window.sessionStorage[_key];
    } catch (_) {
      return null;
    }
  }

  static void saveRaw(String value) {
    try {
      html.window.sessionStorage[_key] = value;
    } catch (_) {}
  }

  static void clear() {
    try {
      html.window.sessionStorage.remove(_key);
    } catch (_) {}
  }
}
