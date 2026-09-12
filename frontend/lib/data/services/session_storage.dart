import 'dart:convert';

import '../../providers/session_provider.dart';
import 'session_storage_stub.dart'
    if (dart.library.html) 'session_storage_web.dart';

class SessionStorageService {
  static void saveSession(SessionState session) {
    if (!session.isInSession) {
      clearSession();
      return;
    }
    try {
      final raw = jsonEncode(session.toJson());
      SessionStorageImpl.saveRaw(raw);
    } catch (_) {}
  }

  static SessionState? loadSession() {
    try {
      final raw = SessionStorageImpl.loadRaw();
      if (raw == null || raw.isEmpty) return null;
      final map = jsonDecode(raw);
      if (map is Map<String, dynamic>) {
        return SessionState.fromJson(map);
      }
    } catch (_) {}
    return null;
  }

  static void clearSession() {
    try {
      SessionStorageImpl.clear();
    } catch (_) {}
  }
}
