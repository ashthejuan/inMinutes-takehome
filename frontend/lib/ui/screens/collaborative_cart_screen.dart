import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../providers/checkout_provider.dart';
import '../../providers/participants_provider.dart';
import '../../theme.dart';

/// Collaborative cart shell — real-time sync lands in Phase 1.
class CollaborativeCartScreen extends ConsumerWidget {
  const CollaborativeCartScreen({super.key, required this.sessionId});

  final String sessionId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final participants = ref.watch(participantsProvider);
    final checkout = ref.watch(checkoutProvider);

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
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                'Session $sessionId',
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: 8),
              const Text(
                'Live cart sync, ready status, and checkout wire up in Phase 1.',
                textAlign: TextAlign.center,
                style: TextStyle(color: AppTheme.textSecondary),
              ),
            ],
          ),
        ),
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
