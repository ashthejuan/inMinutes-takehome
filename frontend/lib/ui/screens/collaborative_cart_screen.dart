import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../providers/cart_provider.dart';
import '../../providers/checkout_provider.dart';
import '../../providers/menu_provider.dart';
import '../../providers/participants_provider.dart';
import '../../providers/session_controller.dart';
import '../../providers/session_provider.dart';
import '../../theme.dart';

/// Collaborative cart — versioned live cart (Phase 2 OCC) + Phase 3
/// ready-gate checkout: every participant toggles Ready, only the host
/// can place the order, and only when all are ready (PRD §5.3 #4/#5).
/// Rows keyed by ValueKey(lineKey): each adder owns their line; only the
/// owner gets qty steppers (others see a static × qty).
class CollaborativeCartScreen extends ConsumerStatefulWidget {
  const CollaborativeCartScreen({super.key, required this.sessionId});

  final String sessionId;

  @override
  ConsumerState<CollaborativeCartScreen> createState() =>
      _CollaborativeCartScreenState();
}

class _CollaborativeCartScreenState
    extends ConsumerState<CollaborativeCartScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final controller = ref.read(sessionControllerProvider);
      controller.onCheckout = (orderId) {
        if (mounted) context.go('/order/$orderId/success');
      };
      controller.onErrorMessage = (code, message) {
        if (!mounted) return;
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (!mounted) return;
          ScaffoldMessenger.of(context)
            ..hideCurrentSnackBar()
            ..showSnackBar(SnackBar(content: Text('$code: $message')));
        });
      };
      controller.onNeedsJoin = (sessionId, joinCode) {
        _promptJoin(sessionId, joinCode);
      };
      controller.ensureJoined(widget.sessionId);
    });
  }

  @override
  void dispose() {
    final controller = ref.read(sessionControllerProvider);
    controller.onCheckout = null;
    controller.onErrorMessage = null;
    controller.onNeedsJoin = null;
    super.dispose();
  }

  Future<void> _promptJoin(String sessionId, String? joinCode) async {
    if (!mounted) return;
    final controller = TextEditingController();
    final name = await showDialog<String>(
      context: context,
      barrierDismissible: false,
      builder: (context) => AlertDialog(
        title: const Text('Join Group Order'),
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
          onSubmitted: (v) {
            final t = v.trim();
            if (t.isNotEmpty) Navigator.of(context).pop(t);
          },
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              final t = controller.text.trim();
              if (t.isNotEmpty) Navigator.of(context).pop(t);
            },
            child: const Text('Join'),
          ),
        ],
      ),
    );
    controller.dispose();
    if (!mounted) return;
    if (name == null || name.isEmpty) {
      context.go('/');
      return;
    }
    try {
      final code = joinCode;
      if (code != null && code.isNotEmpty) {
        final joined = await ref.read(apiClientProvider).joinSession(
              joinCode: code,
              displayName: name,
            );
        final sid =
            (joined['sessionId'] ?? joined['session_id'])?.toString() ??
                sessionId;
        final uid =
            (joined['userId'] ?? joined['user_id'])?.toString() ?? '';
        ref.read(sessionControllerProvider).enterSession(
              sessionId: sid,
              userId: uid,
              joinCode: code,
              displayName: name,
            );
      } else {
        context.go('/group/join');
      }
    } catch (err) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(content: Text('$err')));
      context.go('/');
    }
  }

  String _formatPaise(int paise) => '₹${(paise / 100).toStringAsFixed(0)}';

  @override
  Widget build(BuildContext context) {
    final participants = ref.watch(participantsProvider);
    final checkout = ref.watch(checkoutProvider);
    final groupCart = ref.watch(groupCartProvider);
    final session = ref.watch(sessionProvider);
    final version = session.version;

    final subtotal = groupCart.values
        .fold<int>(0, (sum, line) => sum + line.qty * line.pricePaise);

    Participant? me;
    for (final p in participants) {
      if (p.userId == session.userId) {
        me = p;
        break;
      }
    }
    final myReady = me?.ready ?? false;
    final waiting =
        participants.where((p) => !p.ready).map((p) => p.name).toList();

    final joinCode = session.joinCode;
    final hasJoinCode = joinCode != null && joinCode.isNotEmpty;

    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          tooltip: 'Add items from menu',
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.go('/menu'),
        ),
        title: const Text('Group Order'),
        actions: [
          IconButton(
            tooltip: 'Browse menu',
            icon: const Icon(Icons.restaurant_menu_outlined),
            onPressed: () => context.go('/menu'),
          ),
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
                ref.read(sessionControllerProvider).leave();
                context.go('/');
              }
            },
            child: const Padding(
              padding: EdgeInsets.symmetric(horizontal: 12),
              child: Row(
                mainAxisSize: MainAxisSize.min,
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
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    hasJoinCode
                        ? 'Code $joinCode · v$version'
                        : 'Session ${widget.sessionId} · v$version',
                    style: Theme.of(context).textTheme.titleSmall?.copyWith(
                          color: AppTheme.textSecondary,
                        ),
                  ),
                ),
                if (hasJoinCode)
                  TextButton.icon(
                    onPressed: () async {
                      await Clipboard.setData(ClipboardData(text: joinCode));
                      if (!context.mounted) return;
                      ScaffoldMessenger.of(context)
                        ..hideCurrentSnackBar()
                        ..showSnackBar(
                          const SnackBar(content: Text('Join code copied')),
                        );
                    },
                    icon: const Icon(Icons.copy, size: 16),
                    label: const Text('Copy'),
                  ),
              ],
            ),
          ),
          Expanded(
            child: groupCart.isEmpty
                ? Center(
                    child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Text(
                            'Cart is empty',
                            style: TextStyle(
                              fontWeight: FontWeight.w600,
                              fontSize: 16,
                            ),
                          ),
                          const SizedBox(height: 8),
                          const Text(
                            'Share the join code, then add items from the menu.',
                            textAlign: TextAlign.center,
                            style: TextStyle(color: AppTheme.textSecondary),
                          ),
                          const SizedBox(height: 16),
                          FilledButton(
                            onPressed: () => context.go('/menu'),
                            child: const Text('Browse menu'),
                          ),
                        ],
                      ),
                    ),
                  )
                : ListView(
                    padding: const EdgeInsets.only(bottom: 24),
                    children: [
                      for (final line in groupCart.values)
                        _GroupCartRow(
                          key: ValueKey(line.lineKey),
                          line: line,
                        ),
                    ],
                  ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Subtotal: ${_formatPaise(subtotal)}',
                        style: Theme.of(context).textTheme.titleSmall?.copyWith(
                              fontWeight: FontWeight.w700,
                            ),
                      ),
                      if (!checkout.allReady && waiting.isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.only(top: 4),
                          child: Text(
                            'Waiting for: ${waiting.join(', ')}',
                            style: const TextStyle(
                              color: AppTheme.textSecondary,
                              fontSize: 12,
                            ),
                          ),
                        ),
                      if (!checkout.isHost)
                        const Padding(
                          padding: EdgeInsets.only(top: 4),
                          child: Text(
                            'Only the host can place the order.',
                            style: TextStyle(
                              color: AppTheme.textSecondary,
                              fontSize: 12,
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
                FilledButton.tonal(
                  onPressed: () {
                    ref.read(sessionControllerProvider).setReady(!myReady);
                  },
                  child: Text(myReady ? '✓ Ready (tap to undo)' : 'Mark Ready'),
                ),
              ],
            ),
          ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
              child: SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  onPressed: checkout.canCheckout
                      ? () {
                          ref.read(sessionControllerProvider).checkout();
                        }
                      : null,
                  icon: const Icon(Icons.check, size: 18),
                  label: const Text('Place Order'),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// One group-cart line: attribution + qty stepper (owner only).
/// `key: ValueKey(lineKey)` preserves scroll when a conflict merge rebuilds
/// only the changed rows.
class _GroupCartRow extends ConsumerWidget {
  const _GroupCartRow({super.key, required this.line});

  final CartLine line;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionProvider);
    final isMine = line.addedBy != null && line.addedBy == session.userId;

    void setQty(int qty) {
      if (!isMine) return;
      ref.read(sessionControllerProvider).mutate(line.itemId, qty);
    }

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

    final menu = ref.watch(menuProvider).valueOrNull;
    String? itemName;
    if (menu != null) {
      for (final m in menu) {
        if (m.id == line.itemId) {
          itemName = m.name;
          break;
        }
      }
    }

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
                  itemName ?? line.itemId,
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
          if (isMine) ...[
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
          ] else
            Text(
              '× ${line.qty}',
              style: const TextStyle(
                fontWeight: FontWeight.w600,
                color: AppTheme.textSecondary,
              ),
            ),
        ],
      ),
    );
  }
}
