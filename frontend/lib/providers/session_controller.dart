import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../config.dart';
import '../../data/services/session_socket.dart';
import '../../data/services/session_storage.dart';
import 'cart_provider.dart';
import 'menu_provider.dart';
import 'participants_provider.dart';
import 'session_provider.dart';

/// Pending cart mutation kept for a single `VERSION_CONFLICT` retry (PRD §10.4).
class _PendingMutation {
  _PendingMutation({required this.itemId, required this.qty});

  final String itemId;
  final int qty;
}

/// Glues [SessionSocket] to Riverpod state:
/// - `cart:sync` → replace group cart + bump version. Rows are keyed by
///   `lineKey` (`itemId:userId`), so merges rebuild only changed items.
/// - `error { code: VERSION_CONFLICT, currentVersion, currentState }` →
///   merge `currentState`, refresh baseVersion, retry the pending mutation once.
/// - `participants:sync` → replace participant list (ready gate, PRD §8.2).
/// - `session:checkout` → forwarded to [onCheckout] (screen navigates).
/// - Other `error` codes (ONLY_HOST_CAN_CHECKOUT, NOT_ALL_READY, OUT_OF_STOCK)
///   → forwarded to [onErrorMessage] for a SnackBar.
class SessionController {
  SessionController(this._ref, this._socket) {
    _socket.onCartSync(_handleSync);
    _socket.onError(_handleError);
    _socket.onParticipantsSync(_handleParticipants);
    _socket.onCheckoutAvailable(_handleCheckoutAvailable);
    _socket.onSessionCheckout(_handleCheckout);
    // Phase 4: host transfer + TTL expiry (PRD §5.3 #6, §15 #4).
    _socket.onHostChanged(_handleHostChanged);
    _socket.onSessionExpired(_handleSessionExpired);
    // Transport reconnect (lock / WiFi drop / background): SessionSocket
    // already re-emitted `session:join` and the server replayed full state —
    // just tell the user the view is fresh again.
    _socket.onReconnected = () {
      onErrorMessage?.call('RECONNECTED', 'Back online — cart re-synced');
    };

    // If an active session was already loaded (e.g. from sessionStorage on page refresh),
    // automatically open the socket and rejoin the session room.
    final session = _ref.read(sessionProvider);
    if (session.isInSession && session.sessionId != null && session.userId != null) {
      _socket.connect();
      _socket.join(session.sessionId!, session.userId!);
    }
  }

  final Ref _ref;
  final SessionSocket _socket;
  _PendingMutation? _pending;

  /// Set by the cart screen: navigate to `/order/:id/success`.
  void Function(String orderId)? onCheckout;

  /// Set by the cart screen: show a SnackBar for gate/stock errors.
  void Function(String code, String message)? onErrorMessage;

  /// Set by the cart screen: prompt for name if deep-linking into an unjoined session.
  void Function(String sessionId, String? joinCode)? onNeedsJoin;

  /// Socket.io on Flutter web often delivers JSON numbers as [double], not [int].
  static int? _asInt(dynamic value) {
    if (value is int) return value;
    if (value is num) return value.toInt();
    return null;
  }

  void _handleSync(Map<String, dynamic> payload) {
    final version = _asInt(payload['version']);
    if (version != null) {
      final session = _ref.read(sessionProvider);
      _ref.read(sessionProvider.notifier).setSession(session.copyWith(version: version));
    }
    final cart = payload['cart'];
    if (cart is Map) {
      _applyCart(Map<String, dynamic>.from(cart));
    }
  }

  void _applyCart(Map<String, dynamic> cart) {
    final lines = <String, CartLine>{};
    cart.forEach((key, raw) {
      if (raw is! Map) return;
      final map = Map<String, dynamic>.from(raw);
      final itemId = (map['itemId'] ?? map['item_id'] ?? key).toString();
      final addedBy = map['addedBy']?.toString() ?? map['added_by']?.toString();
      final lineKey = addedBy != null && addedBy.isNotEmpty
          ? '$itemId:$addedBy'
          : key.toString();
      lines[lineKey] = CartLine(
        lineKey: lineKey,
        itemId: itemId,
        qty: _asInt(map['qty']) ?? 0,
        pricePaise: _asInt(map['price']) ?? 0,
        addedBy: addedBy,
      );
    });
    _ref.read(groupCartProvider.notifier).setAll(lines);
  }

  void mutate(String itemId, int qty, {bool fromConflictRetry = false}) {
    final session = _ref.read(sessionProvider);
    final sessionId = session.sessionId;
    final userId = session.userId;
    if (sessionId == null || userId == null) return;
    // Fresh taps may retry once on VERSION_CONFLICT; conflict retries must
    // not chain (stale baseVersion loops when version parsing fails).
    _pending =
        fromConflictRetry ? null : _PendingMutation(itemId: itemId, qty: qty);
    _socket.sendMutation(
      event: qty == 0 ? 'cart:remove' : 'cart:add',
      sessionId: sessionId,
      itemId: itemId,
      qty: qty,
      baseVersion: session.version,
      addedBy: userId,
    );
  }

  /// Phase 3: toggle my ready flag (all-ready gate, PRD §5.3 #5).
  void setReady(bool ready) {
    final session = _ref.read(sessionProvider);
    final sessionId = session.sessionId;
    final userId = session.userId;
    if (sessionId == null || userId == null) return;
    // Optimistic: flip locally so the toggle feels instant; the
    // `participants:sync` broadcast reconciles afterwards.
    final current = _ref.read(participantsProvider);
    _ref.read(participantsProvider.notifier).setAll([
      for (final p in current)
        if (p.userId == userId)
          Participant(userId: p.userId, name: p.name, ready: ready, isHost: p.isHost)
        else
          p,
    ]);
    _socket.setReady(sessionId: sessionId, userId: userId, ready: ready);
  }

  /// Phase 3: host-only checkout (server enforces host + all-ready).
  void checkout() {
    final session = _ref.read(sessionProvider);
    final sessionId = session.sessionId;
    final userId = session.userId;
    if (sessionId == null || userId == null) return;
    _socket.checkout(sessionId: sessionId, userId: userId);
  }

  /// Ensure that the socket is connected and in the room for [sessionId].
  /// Used by CollaborativeCartScreen on mount / browser refresh.
  Future<void> ensureJoined(String sessionId) async {
    if (sessionId.isEmpty) return;
    var session = _ref.read(sessionProvider);
    if (!session.isInSession || session.sessionId != sessionId) {
      final saved = SessionStorageService.loadSession();
      if (saved != null && saved.sessionId == sessionId && saved.userId != null) {
        _ref.read(sessionProvider.notifier).setSession(saved);
        session = saved;
      }
    }

    if (session.sessionId == sessionId && session.userId != null) {
      _socket.connect();
      _socket.join(session.sessionId!, session.userId!);
      return;
    }

    // No local identity for this session (e.g. opened direct link without joining).
    // Verify session existence on backend and trigger join flow if active.
    try {
      final state = await _ref.read(apiClientProvider).fetchSessionState(sessionId);
      final rawSession = state['session'];
      final joinCode = (rawSession is Map)
          ? (rawSession['join_code'] ?? rawSession['joinCode'])?.toString()
          : null;
      onNeedsJoin?.call(sessionId, joinCode);
    } catch (_) {
      onErrorMessage?.call('SESSION_NOT_FOUND', 'Session not found or expired');
    }
  }

  /// After REST create/join: persist identity, open the socket room, and
  /// seed a local participant row until `participants:sync` arrives.
  void enterSession({
    required String sessionId,
    required String userId,
    String? joinCode,
    String? hostId,
    String? displayName,
  }) {
    if (sessionId.isEmpty || userId.isEmpty) return;
    _ref.read(sessionProvider.notifier).setSession(SessionState(
      sessionId: sessionId,
      userId: userId,
      joinCode: joinCode,
      hostId: hostId,
      displayName: displayName,
    ));
    _ref.read(groupCartProvider.notifier).clear();
    _ref.read(participantsProvider.notifier).setAll([
      Participant(
        userId: userId,
        name: displayName ?? userId,
        ready: false,
        isHost: hostId != null && hostId == userId,
      ),
    ]);
    _socket.connect();
    _socket.join(sessionId, userId);
  }

  /// Phase 4: explicit leave — notifies the server (host may transfer)
  /// before the screen navigates away.
  void leave() {
    final session = _ref.read(sessionProvider);
    final sessionId = session.sessionId;
    final userId = session.userId;
    if (sessionId != null && userId != null) {
      _socket.leave(sessionId: sessionId, userId: userId);
    }
    _socket.disconnect();
    _ref.read(sessionProvider.notifier).clear();
    _ref.read(participantsProvider.notifier).clear();
    _ref.read(groupCartProvider.notifier).clear();
  }

  void _handleParticipants(dynamic payload) {
    if (payload is! List) return;
    final next = <Participant>[];
    String? liveHostId;
    for (final raw in payload) {
      if (raw is! Map) continue;
      final map = Map<String, dynamic>.from(raw);
      final userId = map['userId'] ?? map['user_id'];
      if (userId is! String || userId.isEmpty) continue;
      final isHost = map['isHost'] == true ||
          map['is_host'] == 1 ||
          map['is_host'] == true;
      if (isHost) liveHostId = userId;
      next.add(Participant(
        userId: userId,
        name: (map['name'] ?? map['display_name'] ?? userId).toString(),
        ready: map['ready'] == true,
        isHost: isHost,
      ));
    }
    _ref.read(participantsProvider.notifier).setAll(next);
    if (liveHostId != null) {
      final session = _ref.read(sessionProvider);
      if (session.hostId != liveHostId) {
        _ref
            .read(sessionProvider.notifier)
            .setSession(session.copyWith(hostId: liveHostId));
      }
    }
  }

  void _handleCheckout(dynamic payload) {
    if (payload is Map) {
      final map = Map<String, dynamic>.from(payload);
      final orderId = map['orderId'] ?? map['order_id'];
      if (orderId is String && orderId.isNotEmpty) {
        _ref.read(sessionProvider.notifier).clear();
        onCheckout?.call(orderId);
      }
    }
  }

  /// `checkout:available` is derived client-side from participants, but the
  /// broadcast is still the ordering signal: force a participants refresh so
  /// `checkoutProvider` recomputes on every gate change.
  void _handleCheckoutAvailable(dynamic payload) {
    final current = _ref.read(participantsProvider);
    _ref.read(participantsProvider.notifier).setAll([...current]);
  }

  /// Phase 4: `host:changed { hostId }` — flip `session.hostId` (drives
  /// `checkoutProvider.isHost`) and the participant list host badges.
  void _handleHostChanged(dynamic payload) {
    if (payload is! Map) return;
    final map = Map<String, dynamic>.from(payload);
    final hostId = map['hostId'] ?? map['host_id'];
    if (hostId is! String || hostId.isEmpty) return;
    final session = _ref.read(sessionProvider);
    _ref.read(sessionProvider.notifier).setSession(session.copyWith(hostId: hostId));
    final current = _ref.read(participantsProvider);
    _ref.read(participantsProvider.notifier).setAll([
      for (final p in current)
        Participant(
            userId: p.userId, name: p.name, ready: p.ready, isHost: p.userId == hostId),
    ]);
    final isMe = session.userId == hostId;
    onErrorMessage?.call(
        'HOST_TRANSFERRED', isMe ? 'You are now the host' : 'Host transferred');
  }

  /// Phase 4: `session:expired` (+ `error SESSION_EXPIRED`) — surface and
  /// let the screen navigate home.
  void _handleSessionExpired(dynamic payload) {
    _ref.read(sessionProvider.notifier).clear();
    onErrorMessage?.call('SESSION_EXPIRED', 'Session expired');
  }

  void _handleError(Map<String, dynamic> payload) {
    if (payload['code'] == 'VERSION_CONFLICT') {
      final currentVersion = _asInt(payload['currentVersion']);
      if (currentVersion != null) {
        final session = _ref.read(sessionProvider);
        _ref
            .read(sessionProvider.notifier)
            .setSession(session.copyWith(version: currentVersion));
      }
      final currentState = payload['currentState'];
      if (currentState is Map) {
        _applyCart(Map<String, dynamic>.from(currentState));
      }
      // Retry the pending mutation once against the fresh baseVersion.
      final pending = _pending;
      _pending = null;
      if (pending != null) {
        mutate(pending.itemId, pending.qty, fromConflictRetry: true);
      }
      return;
    }
    final code = payload['code']?.toString() ?? 'ERROR';
    final message = payload['message']?.toString() ?? code;
    onErrorMessage?.call(code, message);
  }
}

final sessionSocketProvider = Provider<SessionSocket>((ref) {
  final socket = SessionSocket(baseUrl: apiBaseUrl);
  ref.onDispose(socket.disconnect);
  return socket;
});

final sessionControllerProvider = Provider<SessionController>((ref) {
  return SessionController(ref, ref.watch(sessionSocketProvider));
});
