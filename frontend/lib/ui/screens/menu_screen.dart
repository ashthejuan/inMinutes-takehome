import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../data/models/menu_item.dart';
import '../../providers/cart_provider.dart';
import '../../providers/menu_provider.dart';
import '../../providers/participants_provider.dart';
import '../../providers/session_controller.dart';
import '../../providers/session_provider.dart';
import '../../theme.dart';

class MenuScreen extends ConsumerStatefulWidget {
  const MenuScreen({super.key});

  @override
  ConsumerState<MenuScreen> createState() => _MenuScreenState();
}

class _MenuScreenState extends ConsumerState<MenuScreen> {
  bool _creating = false;

  Future<String?> _askHostName() async {
    final controller = TextEditingController();
    final name = await showDialog<String>(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: const Text('Start Group Order'),
          content: TextField(
            controller: controller,
            autofocus: true,
            textCapitalization: TextCapitalization.words,
            maxLength: 50,
            decoration: const InputDecoration(
              labelText: 'Your display name',
              border: OutlineInputBorder(),
              counterText: '',
            ),
            onSubmitted: (value) {
              final trimmed = value.trim();
              if (trimmed.isNotEmpty) Navigator.of(context).pop(trimmed);
            },
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () {
                final trimmed = controller.text.trim();
                if (trimmed.isEmpty) return;
                Navigator.of(context).pop(trimmed);
              },
              child: const Text('Create'),
            ),
          ],
        );
      },
    );
    controller.dispose();
    return name?.trim();
  }

  Future<void> _startGroupOrder() async {
    if (_creating) return;
    final hostName = await _askHostName();
    if (hostName == null || hostName.isEmpty || !mounted) return;

    setState(() => _creating = true);
    try {
      final created =
          await ref.read(apiClientProvider).createSession(displayName: hostName);
      final sessionId =
          (created['sessionId'] ?? created['id'])?.toString() ?? '';
      final hostId =
          (created['hostId'] ?? created['host_id'])?.toString() ?? '';
      final joinCode =
          (created['joinCode'] ?? created['join_code'])?.toString() ?? '';
      if (sessionId.isEmpty || hostId.isEmpty) {
        throw Exception('Session response missing ids');
      }
      ref.read(sessionControllerProvider).enterSession(
            sessionId: sessionId,
            userId: hostId,
            hostId: hostId,
            joinCode: joinCode.isEmpty ? null : joinCode,
            displayName: hostName,
          );
      if (!mounted) return;
      context.go('/group/$sessionId');
    } catch (err) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(content: Text('$err')));
    } finally {
      if (mounted) setState(() => _creating = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final menuAsync = ref.watch(menuProvider);
    final soloCart = ref.watch(soloCartProvider);
    final session = ref.watch(sessionProvider);
    final groupCart = ref.watch(groupCartProvider);
    final inSession = session.isInSession;
    final badgeCount = inSession
        ? groupCart.values.fold<int>(0, (a, b) => a + b.qty)
        : soloCart.values.fold<int>(0, (a, b) => a + b);

    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          tooltip: inSession ? 'Back to group cart' : 'Back to home',
          icon: const Icon(Icons.arrow_back),
          onPressed: () {
            if (inSession && session.sessionId != null) {
              context.go('/group/${session.sessionId}');
            } else {
              context.go('/');
            }
          },
        ),
        title: Text(inSession ? 'Menu · Group Order' : 'Menu'),
        actions: [
          if (!inSession)
            TextButton(
              onPressed: _creating ? null : _startGroupOrder,
              child: _creating
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Start Group Order'),
            ),
          IconButton(
            tooltip: inSession ? 'Group cart' : 'Cart',
            onPressed: () {
              if (inSession && session.sessionId != null) {
                context.go('/group/${session.sessionId}');
              } else {
                context.go('/cart');
              }
            },
            icon: Badge(
              isLabelVisible: badgeCount > 0,
              label: Text('$badgeCount'),
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

  String _adderLabel(List<Participant> participants, String? addedBy) {
    if (addedBy == null || addedBy.isEmpty) return 'Someone';
    for (final p in participants) {
      if (p.userId == addedBy) return p.name;
    }
    return addedBy;
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionProvider);
    final inSession = session.isInSession;
    final groupCart = inSession ? ref.watch(groupCartProvider) : const <String, CartLine>{};
    final participants = inSession ? ref.watch(participantsProvider) : const <Participant>[];
    final myUserId = session.userId;

    final itemLines = <CartLine>[
      for (final line in groupCart.values)
        if (line.itemId == item.id) line,
    ];
    CartLine? myLine;
    for (final line in itemLines) {
      if (line.addedBy == myUserId) {
        myLine = line;
        break;
      }
    }
    final myQty = inSession
        ? (myLine?.qty ?? 0)
        : (ref.watch(soloCartProvider)[item.id] ?? 0);
    final totalQty = inSession
        ? itemLines.fold<int>(0, (sum, line) => sum + line.qty)
        : myQty;
    final outOfStock = item.stock <= 0;
    final atCap = totalQty >= item.stock;

    void setMyQty(int next) {
      if (inSession) {
        ref.read(sessionControllerProvider).mutate(item.id, next);
      } else {
        ref.read(soloCartProvider.notifier).setQty(item.id, next);
      }
    }

    final otherLines = [
      for (final line in itemLines)
        if (line.addedBy != myUserId) line,
    ];

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
                if (inSession && otherLines.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  for (final line in otherLines)
                    Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: Text(
                        'Added by ${_adderLabel(participants, line.addedBy)} (quantity ${line.qty})',
                        style: const TextStyle(
                          color: AppTheme.textSecondary,
                          fontSize: 12,
                        ),
                      ),
                    ),
                ],
                if (inSession && myQty > 0)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(
                      'Added by you (quantity $myQty)',
                      style: const TextStyle(
                        color: AppTheme.textSecondary,
                        fontSize: 12,
                      ),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          _QtyControls(
            qty: myQty,
            enabled: !outOfStock && !atCap,
            onDecrement: () => setMyQty(myQty - 1),
            onIncrement: () {
              if (atCap) return;
              setMyQty(myQty + 1);
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
        child: FilledButton(
          onPressed: enabled ? onIncrement : null,
          style: FilledButton.styleFrom(
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
