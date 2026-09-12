import 'package:flutter_test/flutter_test.dart';
import 'package:food_order/data/services/session_storage.dart';
import 'package:food_order/providers/session_provider.dart';

void main() {
  setUp(() {
    SessionStorageService.clearSession();
  });

  tearDown(() {
    SessionStorageService.clearSession();
  });

  group('SessionState serialization', () {
    test('round-trip toJson and fromJson preserves all fields', () {
      const state = SessionState(
        sessionId: 'sess_123',
        userId: 'usr_456',
        hostId: 'usr_456',
        joinCode: 'ABCDEF',
        displayName: 'Alice',
        version: 5,
      );

      final json = state.toJson();
      final restored = SessionState.fromJson(json);

      expect(restored.sessionId, 'sess_123');
      expect(restored.userId, 'usr_456');
      expect(restored.hostId, 'usr_456');
      expect(restored.joinCode, 'ABCDEF');
      expect(restored.displayName, 'Alice');
      expect(restored.version, 5);
      expect(restored.isInSession, isTrue);
      expect(restored.isHost, isTrue);
    });
  });

  group('SessionStorageService', () {
    test('returns null when storage is empty', () {
      expect(SessionStorageService.loadSession(), isNull);
    });

    test('saves and loads session state', () {
      const state = SessionState(
        sessionId: 'sess_abc',
        userId: 'usr_guest',
        hostId: 'usr_host',
        joinCode: 'XYZ987',
        displayName: 'Bob',
        version: 2,
      );

      SessionStorageService.saveSession(state);
      final loaded = SessionStorageService.loadSession();

      expect(loaded, isNotNull);
      expect(loaded!.sessionId, 'sess_abc');
      expect(loaded.userId, 'usr_guest');
      expect(loaded.hostId, 'usr_host');
      expect(loaded.joinCode, 'XYZ987');
      expect(loaded.displayName, 'Bob');
      expect(loaded.version, 2);
      expect(loaded.isInSession, isTrue);
      expect(loaded.isHost, isFalse);
    });

    test('clearSession wipes stored session', () {
      const state = SessionState(
        sessionId: 'sess_abc',
        userId: 'usr_guest',
      );
      SessionStorageService.saveSession(state);
      expect(SessionStorageService.loadSession(), isNotNull);

      SessionStorageService.clearSession();
      expect(SessionStorageService.loadSession(), isNull);
    });

    test('saving empty session clears storage', () {
      const state = SessionState(
        sessionId: 'sess_abc',
        userId: 'usr_guest',
      );
      SessionStorageService.saveSession(state);
      expect(SessionStorageService.loadSession(), isNotNull);

      SessionStorageService.saveSession(const SessionState());
      expect(SessionStorageService.loadSession(), isNull);
    });
  });
}
