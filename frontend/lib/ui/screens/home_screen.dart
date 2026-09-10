import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../theme.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;

    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'inMinutes',
                style: textTheme.headlineMedium?.copyWith(
                  fontWeight: FontWeight.w700,
                  letterSpacing: -0.5,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'Order alone or start a shared cart with your table.',
                style: textTheme.bodyLarge?.copyWith(
                  color: AppTheme.textSecondary,
                ),
              ),
              const Spacer(),
              FilledButton(
                onPressed: () => context.go('/menu'),
                child: const Text('Normal Order'),
              ),
              const SizedBox(height: 12),
              OutlinedButton(
                onPressed: () => context.go('/group/join'),
                child: const Text('Join Group Order'),
              ),
              const SizedBox(height: 12),
              TextButton(
                onPressed: () => context.go('/menu'),
                child: const Text('Browse menu / start as host'),
              ),
              const SizedBox(height: 24),
            ],
          ),
        ),
      ),
    );
  }
}
