import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Active group session identity (REST create/join + socket room).
class SessionState {
  const SessionState({
    this.sessionId,
    this.joinCode,
    this.userId,
    this.hostId,
    this.displayName,
    this.version = 0,
  });

  final String? sessionId;
  final String? joinCode;
  final String? userId;
  final String? hostId;
  final String? displayName;
  final int version;

  bool get isInSession => sessionId != null && userId != null;

  bool get isHost =>
      isInSession && hostId != null && userId != null && hostId == userId;

  SessionState copyWith({
    String? sessionId,
    String? joinCode,
    String? userId,
    String? hostId,
    String? displayName,
    int? version,
  }) {
    return SessionState(
      sessionId: sessionId ?? this.sessionId,
      joinCode: joinCode ?? this.joinCode,
      userId: userId ?? this.userId,
      hostId: hostId ?? this.hostId,
      displayName: displayName ?? this.displayName,
      version: version ?? this.version,
    );
  }
}

class SessionNotifier extends StateNotifier<SessionState> {
  SessionNotifier() : super(const SessionState());

  void setSession(SessionState next) {
    state = next;
  }

  void clear() {
    state = const SessionState();
  }
}

final sessionProvider =
    StateNotifierProvider<SessionNotifier, SessionState>((ref) {
  return SessionNotifier();
});
