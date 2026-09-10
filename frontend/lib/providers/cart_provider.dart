import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Per-item cart line (family keyed by itemId). Mutations wired in Phase 1.
class CartLine {
  const CartLine({
    required this.itemId,
    required this.qty,
    required this.pricePaise,
    this.addedBy,
  });

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
