import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../data/models/menu_item.dart';
import '../../providers/cart_provider.dart';
import '../../providers/menu_provider.dart';
import '../../theme.dart';

class CartScreen extends ConsumerWidget {
  const CartScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final cart = ref.watch(soloCartProvider);
    final menuAsync = ref.watch(menuProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Cart')),
      body: menuAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, _) => Center(child: Text(err.toString())),
        data: (menu) {
          final byId = {for (final m in menu) m.id: m};
          final lines = <({MenuItem item, int qty})>[];
          for (final entry in cart.entries) {
            final item = byId[entry.key];
            if (item != null) {
              lines.add((item: item, qty: entry.value));
            }
          }

          if (lines.isEmpty) {
            return Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Text(
                    'Cart is empty',
                    style: TextStyle(color: AppTheme.textSecondary),
                  ),
                  const SizedBox(height: 12),
                  TextButton(
                    onPressed: () => context.go('/menu'),
                    child: const Text('Browse menu'),
                  ),
                ],
              ),
            );
          }

          var subtotal = 0;
          for (final line in lines) {
            subtotal += line.item.pricePaise * line.qty;
          }

          return Column(
            children: [
              Expanded(
                child: ListView.separated(
                  itemCount: lines.length,
                  separatorBuilder: (_, __) => const Divider(height: 1),
                  itemBuilder: (context, index) {
                    final line = lines[index];
                    return ListTile(
                      title: Text(line.item.name),
                      subtitle: Text(line.item.priceLabel),
                      trailing: Text(
                        '× ${line.qty}',
                        style: const TextStyle(fontWeight: FontWeight.w600),
                      ),
                    );
                  },
                ),
              ),
              const Divider(height: 1),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(
                          'Subtotal',
                          style: Theme.of(context).textTheme.titleMedium,
                        ),
                        Text(
                          '₹${(subtotal / 100).toStringAsFixed(0)}',
                          style: Theme.of(context).textTheme.titleMedium,
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    FilledButton(
                      onPressed: () {
                        ref.read(soloCartProvider.notifier).clear();
                        context.go('/order/solo-demo/success');
                      },
                      child: const Text('Place Order'),
                    ),
                  ],
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}
