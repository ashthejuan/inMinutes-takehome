import 'package:socket_io_client/socket_io_client.dart' as io;

/// Thin Socket.io wrapper for the group-session protocol (PRD §8).
/// Every cart mutation carries the last-seen version as `baseVersion` (PRD §10).
class SessionSocket {
  SessionSocket({required this.baseUrl});

  final String baseUrl;
  io.Socket? _socket;

  bool get isConnected => _socket?.connected ?? false;

  void connect() {
    disconnect();
    _socket = io.io(
      baseUrl,
      io.OptionBuilder().setTransports(['websocket']).build(),
    );
  }

  void onCartSync(void Function(Map<String, dynamic> payload) handler) {
    _socket?.on('cart:sync', (data) {
      if (data is Map) handler(Map<String, dynamic>.from(data));
    });
  }

  void onError(void Function(Map<String, dynamic> payload) handler) {
    _socket?.on('error', (data) {
      if (data is Map) handler(Map<String, dynamic>.from(data));
    });
  }

  void join(String sessionId, String userId) {
    _socket?.emit('session:join', {'sessionId': sessionId, 'userId': userId});
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
    _socket = null;
  }
}
