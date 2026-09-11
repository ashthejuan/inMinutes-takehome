import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../config.dart';
import '../../data/services/session_socket.dart';
import 'cart_provider.dart';
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
///   `ValueKey(itemId)`, so merges rebuild only changed items (no scroll jump).
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
    _socket.onSessionCheckout(_handleCheckout);
  }

  final Ref _ref;
  final SessionSocket _socket;
  _PendingMutation? _pending;

  /// Set by the cart screen: navigate to `/order/:id/success`.
  void Function(String orderId)? onCheckout;

  /// Set by the cart screen: show a SnackBar for gate/stock errors.
  void Function(String code, String message)? onErrorMessage;

  void _handleSync(Map<String, dynamic> payload) {
    final version = payload['version'];
    if (version is int) {
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
    cart.forEach((itemId, raw) {
      if (raw is Map) {
        lines[itemId] = CartLine(
          itemId: itemId,
          qty: (raw['qty'] as num?)?.toInt() ?? 0,
          pricePaise: (raw['price'] as num?)?.toInt() ?? 0,
          addedBy: raw['addedBy'] as String?,
        );
      }
    });
    _ref.read(groupCartProvider.notifier).setAll(lines);
  }

  void mutate(String itemId, int qty) {
    final session = _ref.read(sessionProvider);
    final sessionId = session.sessionId;
    if (sessionId == null) return;
    _pending = _PendingMutation(itemId: itemId, qty: qty);
    _socket.sendMutation(
      event: qty == 0 ? 'cart:remove' : 'cart:add',
      sessionId: sessionId,
      itemId: itemId,
      qty: qty,
      baseVersion: session.version,
      addedBy: session.userId,
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

  void _handleParticipants(dynamic payload) {
    if (payload is! List) return;
    final next = <Participant>[];
    for (final raw in payload) {
      if (raw is! Map) continue;
      final map = Map<String, dynamic>.from(raw);
      final userId = map['userId'] ?? map['user_id'];
      if (userId is! String || userId.isEmpty) continue;
      next.add(Participant(
        userId: userId,
        name: (map['name'] ?? map['display_name'] ?? userId).toString(),
        ready: map['ready'] == true,
        isHost: map['isHost'] == true || map['is_host'] == 1 || map['is_host'] == true,
      ));
    }
    _ref.read(participantsProvider.notifier).setAll(next);
  }

  void _handleCheckout(dynamic payload) {
    if (payload is Map) {
      final map = Map<String, dynamic>.from(payload);
      final orderId = map['orderId'] ?? map['order_id'];
      if (orderId is String && orderId.isNotEmpty) {
        onCheckout?.call(orderId);
      }
    }
  }

  void _handleError(Map<String, dynamic> payload) {
    if (payload['code'] == 'VERSION_CONFLICT') {
      final currentVersion = payload['currentVersion'];
      if (currentVersion is int) {
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
      if (pending != null) mutate(pending.itemId, pending.qty);
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
