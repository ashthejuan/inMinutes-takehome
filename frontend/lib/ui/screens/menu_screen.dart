import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../data/models/menu_item.dart';
import '../../providers/cart_provider.dart';
import '../../providers/menu_provider.dart';
import '../../theme.dart';

class MenuScreen extends ConsumerWidget {
  const MenuScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final menuAsync = ref.watch(menuProvider);
    final soloCart = ref.watch(soloCartProvider);

    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          tooltip: 'Back to home',
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.go('/'),
        ),
        title: const Text('Menu'),
        actions: [
          TextButton(
            onPressed: () {
              // Group session creation lands in Phase 1.
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(
                  content: Text('Group order creation comes in Phase 1'),
                ),
              );
            },
            child: const Text('Start Group Order'),
          ),
          IconButton(
            tooltip: 'Cart',
            onPressed: () => context.go('/cart'),
            icon: Badge(
              isLabelVisible: soloCart.isNotEmpty,
              label: Text('${soloCart.values.fold<int>(0, (a, b) => a + b)}'),
              child: const Icon(Icons.shopping_bag_outlined),
            ),
          ),
        ],
      ),
      body: menuAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, _) => _MenuError(
          message: err.toString(),
          onRetry: () => ref.invalidate(menuProvider),
        ),
        data: (items) => _MenuList(items: items),
      ),
    );
  }
}

class _MenuError extends StatelessWidget {
  const _MenuError({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              'Could not load menu',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            Text(
              message,
              textAlign: TextAlign.center,
              style: const TextStyle(color: AppTheme.textSecondary),
            ),
            const SizedBox(height: 16),
            FilledButton(onPressed: onRetry, child: const Text('Retry')),
          ],
        ),
      ),
    );
  }
}

class _MenuList extends ConsumerStatefulWidget {
  const _MenuList({required this.items});

  final List<MenuItem> items;

  /// Canonical display order: starters → mains → breads → desserts → drinks.
  /// Unknown categories (if the backend ever adds one) sort after these,
  /// alphabetically.
  static const categoryOrder = [
    'Starters',
    'Mains',
    'Breads',
    'Desserts',
    'Drinks',
  ];

  @override
  ConsumerState<_MenuList> createState() => _MenuListState();
}

class _MenuListState extends ConsumerState<_MenuList> {
  /// Collapsed category names. All sections start expanded.
  final Set<String> _collapsed = {};

  @override
  Widget build(BuildContext context) {
    final categories = <String, List<MenuItem>>{};
    for (final item in widget.items) {
      categories.putIfAbsent(item.category, () => []).add(item);
    }
    final categoryNames = categories.keys.toList(growable: false)
      ..sort((a, b) {
        final ai = _MenuList.categoryOrder.indexOf(a);
        final bi = _MenuList.categoryOrder.indexOf(b);
        if (ai != -1 && bi != -1) return ai.compareTo(bi);
        if (ai != -1) return -1;
        if (bi != -1) return 1;
        return a.compareTo(b);
      });

    return ListView.builder(
      padding: const EdgeInsets.only(bottom: 24),
      itemCount: categoryNames.length,
      itemBuilder: (context, index) {
        final category = categoryNames[index];
        final categoryItems = categories[category]!;
        final expanded = !_collapsed.contains(category);
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            InkWell(
              onTap: () => setState(() {
                if (expanded) {
                  _collapsed.add(category);
                } else {
                  _collapsed.remove(category);
                }
              }),
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 20, 8, 8),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        category,
                        style:
                            Theme.of(context).textTheme.titleMedium?.copyWith(
                                  fontWeight: FontWeight.w600,
                                ),
                      ),
                    ),
                    Text(
                      '${categoryItems.length}',
                      style: const TextStyle(
                        color: AppTheme.textSecondary,
                        fontSize: 13,
                      ),
                    ),
                    Icon(
                      expanded
                          ? Icons.expand_less
                          : Icons.expand_more,
                      color: AppTheme.textSecondary,
                    ),
                  ],
                ),
              ),
            ),
            const Divider(height: 1),
            AnimatedCrossFade(
              firstChild: Column(
                children: [
                  for (final item in categoryItems)
                    _MenuRow(
                      key: ValueKey(item.id),
                      item: item,
                    ),
                ],
              ),
              secondChild: const SizedBox.shrink(),
              crossFadeState: expanded
                  ? CrossFadeState.showFirst
                  : CrossFadeState.showSecond,
              duration: const Duration(milliseconds: 200),
            ),
          ],
        );
      },
    );
  }
}

class _MenuRow extends ConsumerWidget {
  const _MenuRow({super.key, required this.item});

  final MenuItem item;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final qty = ref.watch(soloCartProvider)[item.id] ?? 0;
    final outOfStock = item.stock <= 0;

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _Thumb(imageUrl: item.imageUrl),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  item.name,
                  style: Theme.of(context).textTheme.titleSmall?.copyWith(
                        fontWeight: FontWeight.w600,
                      ),
                ),
                if (item.description != null && item.description!.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text(
                      item.description!,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppTheme.textSecondary,
                        fontSize: 13,
                      ),
                    ),
                  ),
                const SizedBox(height: 6),
                Text(
                  '${item.priceLabel}  ·  ${item.stockLabel}',
                  style: TextStyle(
                    color: outOfStock ? Colors.red.shade700 : AppTheme.textSecondary,
                    fontSize: 13,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          _QtyControls(
            qty: qty,
            enabled: !outOfStock,
            onDecrement: () {
              ref.read(soloCartProvider.notifier).setQty(item.id, qty - 1);
            },
            onIncrement: () {
              if (qty >= item.stock) {
                return;
              }
              ref.read(soloCartProvider.notifier).setQty(item.id, qty + 1);
            },
          ),
        ],
      ),
    );
  }
}

class _Thumb extends StatelessWidget {
  const _Thumb({this.imageUrl});

  final String? imageUrl;

  @override
  Widget build(BuildContext context) {
    final placeholder = Container(
      width: 56,
      height: 56,
      decoration: BoxDecoration(
        color: AppTheme.border.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: AppTheme.border),
      ),
    );

    if (imageUrl == null || imageUrl!.isEmpty) {
      return placeholder;
    }

    return ClipRRect(
      borderRadius: BorderRadius.circular(6),
      child: CachedNetworkImage(
        imageUrl: imageUrl!,
        width: 56,
        height: 56,
        fit: BoxFit.cover,
        placeholder: (_, __) => placeholder,
        errorWidget: (_, __, ___) => placeholder,
      ),
    );
  }
}

class _QtyControls extends StatelessWidget {
  const _QtyControls({
    required this.qty,
    required this.enabled,
    required this.onDecrement,
    required this.onIncrement,
  });

  final int qty;
  final bool enabled;
  final VoidCallback onDecrement;
  final VoidCallback onIncrement;

  @override
  Widget build(BuildContext context) {
    if (qty == 0) {
      return SizedBox(
        height: 36,
        child: OutlinedButton(
          onPressed: enabled ? onIncrement : null,
          style: OutlinedButton.styleFrom(
            minimumSize: const Size(64, 36),
            padding: const EdgeInsets.symmetric(horizontal: 12),
          ),
          child: const Text('Add'),
        ),
      );
    }

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        IconButton(
          onPressed: onDecrement,
          icon: const Icon(Icons.remove, size: 18),
          visualDensity: VisualDensity.compact,
        ),
        Text('$qty', style: const TextStyle(fontWeight: FontWeight.w600)),
        IconButton(
          onPressed: enabled ? onIncrement : null,
          icon: const Icon(Icons.add, size: 18),
          visualDensity: VisualDensity.compact,
        ),
      ],
    );
  }
}
