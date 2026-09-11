import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../providers/cart_provider.dart';
import '../../providers/checkout_provider.dart';
import '../../providers/participants_provider.dart';
import '../../providers/session_controller.dart';
import '../../providers/session_provider.dart';
import '../../theme.dart';

/// Collaborative cart — versioned live cart (Phase 2 OCC).
/// Rows keyed by ValueKey(itemId): conflict merges rebuild only changed
/// items, preserving scroll position.
class CollaborativeCartScreen extends ConsumerWidget {
  const CollaborativeCartScreen({super.key, required this.sessionId});

  final String sessionId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final participants = ref.watch(participantsProvider);
    final checkout = ref.watch(checkoutProvider);
    final groupCart = ref.watch(groupCartProvider);
    final version = ref.watch(sessionProvider.select((s) => s.version));

    return Scaffold(
      appBar: AppBar(
        title: const Text('Group Order'),
        actions: [
          PopupMenuButton<String>(
            tooltip: 'Participants',
            itemBuilder: (context) {
              if (participants.isEmpty) {
                return const [
                  PopupMenuItem(
                    enabled: false,
                    child: Text('No participants yet'),
                  ),
                ];
              }
              return [
                for (final p in participants)
                  PopupMenuItem(
                    enabled: false,
                    child: Text(
                      '${p.isHost ? 'Host · ' : ''}${p.name} — ${p.ready ? 'Ready' : 'Browsing'}',
                    ),
                  ),
                const PopupMenuDivider(),
                const PopupMenuItem(
                  value: 'leave',
                  child: Text('Leave session'),
                ),
              ];
            },
            onSelected: (value) {
              if (value == 'leave') {
                context.go('/');
              }
            },
            child: const Padding(
              padding: EdgeInsets.symmetric(horizontal: 12),
              child: Row(
                children: [
                  Icon(Icons.group_outlined),
                  SizedBox(width: 4),
                  Icon(Icons.arrow_drop_down),
                ],
              ),
            ),
          ),
        ],
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
            child: Text(
              'Session $sessionId · v$version',
              style: Theme.of(context).textTheme.titleSmall?.copyWith(
                    color: AppTheme.textSecondary,
                  ),
            ),
          ),
          Expanded(
            child: groupCart.isEmpty
                ? const Center(
                    child: Text(
                      'Cart is empty — add items from the menu.',
                      style: TextStyle(color: AppTheme.textSecondary),
                    ),
                  )
                : ListView(
                    padding: const EdgeInsets.only(bottom: 24),
                    children: [
                      for (final line in groupCart.values)
                        _GroupCartRow(
                          key: ValueKey(line.itemId),
                          line: line,
                        ),
                    ],
                  ),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: checkout.canCheckout
            ? () {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Checkout lands in Phase 3')),
                );
              }
            : null,
        backgroundColor: checkout.canCheckout ? AppTheme.accent : AppTheme.border,
        foregroundColor:
            checkout.canCheckout ? Colors.white : AppTheme.textSecondary,
        label: const Text('Place Order'),
        icon: const Icon(Icons.check),
      ),
    );
  }
}

/// One group-cart line: attribution badge (display only) + qty stepper.
/// `key: ValueKey(itemId)` preserves scroll when a conflict merge rebuilds
/// only the changed rows.
class _GroupCartRow extends ConsumerWidget {
  const _GroupCartRow({super.key, required this.line});

  final CartLine line;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    void setQty(int qty) {
      ref.read(sessionControllerProvider).mutate(line.itemId, qty);
    }

    // Attribution is display-only: resolve the adder's name when known.
    final participants = ref.watch(participantsProvider);
    String? adderName;
    for (final p in participants) {
      if (p.userId == line.addedBy) {
        adderName = p.name;
        break;
      }
    }
    final adderLabel = adderName ?? line.addedBy;
    final hasAttribution = adderLabel != null && adderLabel.isNotEmpty;

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      child: Row(
        children: [
          if (hasAttribution)
            Padding(
              padding: const EdgeInsets.only(right: 10),
              child: CircleAvatar(
                radius: 13,
                backgroundColor: AppTheme.border,
                child: Text(
                  adderLabel.trim()[0].toUpperCase(),
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: AppTheme.textSecondary,
                  ),
                ),
              ),
            ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  line.itemId,
                  style: Theme.of(context).textTheme.titleSmall?.copyWith(
                        fontWeight: FontWeight.w600,
                      ),
                ),
                if (hasAttribution)
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text(
                      'Added by $adderLabel',
                      style: const TextStyle(
                        color: AppTheme.textSecondary,
                        fontSize: 12,
                      ),
                    ),
                  ),
              ],
            ),
          ),
          IconButton(
            onPressed: () => setQty(line.qty - 1),
            icon: const Icon(Icons.remove, size: 18),
            visualDensity: VisualDensity.compact,
          ),
          Text('${line.qty}',
              style: const TextStyle(fontWeight: FontWeight.w600)),
          IconButton(
            onPressed: () => setQty(line.qty + 1),
            icon: const Icon(Icons.add, size: 18),
            visualDensity: VisualDensity.compact,
          ),
        ],
      ),
    );
  }
}
