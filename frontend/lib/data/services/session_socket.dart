import 'package:socket_io_client/socket_io_client.dart' as io;

/// Thin Socket.io wrapper for the group-session protocol (PRD §8).
/// Every cart mutation carries the last-seen version as `baseVersion` (PRD §10).
///
/// Handlers are stored and re-attached on [connect] so listeners registered
/// before the socket exists (Riverpod provider init) still work.
class SessionSocket {
  SessionSocket({required this.baseUrl});

  final String baseUrl;
  io.Socket? _socket;

  final Map<String, void Function(dynamic)> _handlers = {};

  bool get isConnected => _socket?.connected ?? false;

  void connect() {
    disconnect();
    _socket = io.io(
      baseUrl,
      io.OptionBuilder().setTransports(['websocket']).disableAutoConnect().build(),
    );
    for (final entry in _handlers.entries) {
      _socket!.on(entry.key, entry.value);
    }
    _socket!.connect();
  }

  void _on(String event, void Function(dynamic) handler) {
    _handlers[event] = handler;
    _socket?.on(event, handler);
  }

  void onCartSync(void Function(Map<String, dynamic> payload) handler) {
    _on('cart:sync', (data) {
      if (data is Map) handler(Map<String, dynamic>.from(data));
    });
  }

  void onError(void Function(Map<String, dynamic> payload) handler) {
    _on('error', (data) {
      if (data is Map) handler(Map<String, dynamic>.from(data));
    });
  }

  void onParticipantsSync(void Function(dynamic payload) handler) {
    _on('participants:sync', handler);
  }

  void onCheckoutAvailable(void Function(dynamic payload) handler) {
    _on('checkout:available', handler);
  }

  void onSessionCheckout(void Function(dynamic payload) handler) {
    _on('session:checkout', handler);
  }

  /// Phase 4: host transfer (PRD §5.3 #6) + TTL expiry (PRD §15 #4).
  void onHostChanged(void Function(dynamic payload) handler) {
    _on('host:changed', handler);
  }

  void onSessionExpired(void Function(dynamic payload) handler) {
    _on('session:expired', handler);
  }

  void join(String sessionId, String userId) {
    void emitJoin() {
      _socket?.emit('session:join', {'sessionId': sessionId, 'userId': userId});
    }

    if (_socket?.connected == true) {
      emitJoin();
      return;
    }
    _socket?.once('connect', (_) => emitJoin());
  }

  /// Phase 4: explicit leave — server detaches presence, transfers host
  /// when needed, and removes the socket from the room.
  void leave({required String sessionId, required String userId}) {
    _socket?.emit('session:leave', {'sessionId': sessionId, 'userId': userId});
  }

  /// Phase 3: ready toggle (PRD §8.1 `user:ready`).
  void setReady({
    required String sessionId,
    required String userId,
    required bool ready,
  }) {
    _socket?.emit('user:ready', {
      'sessionId': sessionId,
      'userId': userId,
      'ready': ready,
    });
  }

  /// Phase 3: host-only checkout (PRD §8.1 `checkout`).
  void checkout({required String sessionId, required String userId}) {
    _socket?.emit('checkout', {'sessionId': sessionId, 'userId': userId});
  }

  void sendMutation({
    required String event,
    required String sessionId,
    required String itemId,
    required int qty,
    required int baseVersion,
    String? addedBy,
  }) {
    _socket?.emit(event, {
      'sessionId': sessionId,
      'itemId': itemId,
      'qty': qty,
      'baseVersion': baseVersion,
      if (addedBy != null) 'addedBy': addedBy,
    });
  }

  void disconnect() {
    _socket?.disconnect();
    _socket?.dispose();
    _socket = null;
  }
}
