import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/services/session_storage.dart';

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

  Map<String, dynamic> toJson() => {
        if (sessionId != null) 'sessionId': sessionId,
        if (joinCode != null) 'joinCode': joinCode,
        if (userId != null) 'userId': userId,
        if (hostId != null) 'hostId': hostId,
        if (displayName != null) 'displayName': displayName,
        'version': version,
      };

  factory SessionState.fromJson(Map<String, dynamic> json) {
    return SessionState(
      sessionId: json['sessionId'] as String?,
      joinCode: json['joinCode'] as String?,
      userId: json['userId'] as String?,
      hostId: json['hostId'] as String?,
      displayName: json['displayName'] as String?,
      version: (json['version'] as num?)?.toInt() ?? 0,
    );
  }

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
  SessionNotifier()
      : super(SessionStorageService.loadSession() ?? const SessionState());

  void setSession(SessionState next) {
    state = next;
    if (next.isInSession) {
      SessionStorageService.saveSession(next);
    } else {
      SessionStorageService.clearSession();
    }
  }

  void clear() {
    state = const SessionState();
    SessionStorageService.clearSession();
  }
}

final sessionProvider =
    StateNotifierProvider<SessionNotifier, SessionState>((ref) {
  return SessionNotifier();
});
