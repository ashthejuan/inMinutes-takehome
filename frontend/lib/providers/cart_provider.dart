import 'package:flutter_riverpod/flutter_riverpod.dart';

/// One participant's contribution of a menu item in a group cart.
/// Server keys lines by `itemId:addedBy` so ownership is enforceable.
class CartLine {
  const CartLine({
    required this.lineKey,
    required this.itemId,
    required this.qty,
    required this.pricePaise,
    this.addedBy,
  });

  final String lineKey;
  final String itemId;
  final int qty;
  final int pricePaise;
  final String? addedBy;
}

class CartLineNotifier extends StateNotifier<CartLine?> {
  CartLineNotifier(this.itemId) : super(null);

  final String itemId;

  void apply(CartLine? line) {
    state = line;
  }
}

final cartProvider =
    StateNotifierProvider.family<CartLineNotifier, CartLine?, String>(
  (ref, itemId) => CartLineNotifier(itemId),
);

/// Solo-order cart quantities (local only until checkout is implemented).
class SoloCartNotifier extends StateNotifier<Map<String, int>> {
  SoloCartNotifier() : super(const {});

  void setQty(String itemId, int qty) {
    if (qty <= 0) {
      final next = Map<String, int>.from(state)..remove(itemId);
      state = next;
      return;
    }
    state = {...state, itemId: qty};
  }

  void clear() {
    state = const {};
  }
}

final soloCartProvider =
    StateNotifierProvider<SoloCartNotifier, Map<String, int>>((ref) {
  return SoloCartNotifier();
});

/// Group-session cart. The server is the source of truth: replaced wholesale
/// on every `cart:sync` / conflict merge (rows keyed by lineKey = itemId:userId).
class GroupCartNotifier extends StateNotifier<Map<String, CartLine>> {
  GroupCartNotifier() : super(const {});

  void setAll(Map<String, CartLine> next) {
    state = Map.unmodifiable(next);
  }

  void clear() {
    state = const {};
  }
}

final groupCartProvider =
    StateNotifierProvider<GroupCartNotifier, Map<String, CartLine>>((ref) {
  return GroupCartNotifier();
});
