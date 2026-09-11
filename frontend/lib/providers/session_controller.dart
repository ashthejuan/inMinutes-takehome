import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../config.dart';
import '../../data/services/session_socket.dart';
import 'cart_provider.dart';
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
class SessionController {
  SessionController(this._ref, this._socket) {
    _socket.onCartSync(_handleSync);
    _socket.onError(_handleError);
  }

  final Ref _ref;
  final SessionSocket _socket;
  _PendingMutation? _pending;

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

  void _handleError(Map<String, dynamic> payload) {
    if (payload['code'] != 'VERSION_CONFLICT') return;
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
