import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../theme.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    final width = MediaQuery.sizeOf(context).width;
    final diameter = width * 1.35;
    final radius = Radius.circular(diameter / 2);

    return Scaffold(
      body: Stack(
        children: [
          // Purple granient half-circle hanging from the top edge.
          Positioned(
            top: 0,
            left: (width - diameter) / 2,
            width: diameter,
            height: diameter / 2,
            child: ClipRRect(
              borderRadius: BorderRadius.vertical(bottom: radius),
              child: Stack(
                fit: StackFit.expand,
                children: [
                  DecoratedBox(
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        begin: Alignment.topCenter,
                        end: Alignment.bottomCenter,
                        colors: [
                          AppTheme.accent,
                          AppTheme.accent.withValues(alpha: 0.55),
                          AppTheme.accent.withValues(alpha: 0.0),
                        ],
                        stops: const [0.0, 0.55, 1.0],
                      ),
                    ),
                  ),
                  const CustomPaint(painter: _GrainPainter()),
                ],
              ),
            ),
          ),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const SizedBox(height: 48),
                  Text(
                    'inMinutes',
                    textAlign: TextAlign.center,
                    style: textTheme.headlineMedium?.copyWith(
                      fontWeight: FontWeight.w700,
                      letterSpacing: -0.5,
                      color: Colors.white,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Order alone or start a shared cart with your table.',
                    textAlign: TextAlign.center,
                    style: textTheme.bodyLarge?.copyWith(
                      color: Colors.white.withValues(alpha: 0.9),
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
        ],
      ),
    );
  }
}

/// Seeded film-grain overlay for the hero semicircle.
class _GrainPainter extends CustomPainter {
  const _GrainPainter();

  @override
  void paint(Canvas canvas, Size size) {
    final rng = math.Random(42);
    final paint = Paint()..style = PaintingStyle.fill;
    const step = 1.5;

    for (var y = 0.0; y < size.height; y += step) {
      for (var x = 0.0; x < size.width; x += step) {
        final roll = rng.nextDouble();
        if (roll < 0.4) {
          paint.color = Color.fromRGBO(
            255,
            255,
            255,
            0.05 + rng.nextDouble() * 0.12,
          );
          canvas.drawRect(Rect.fromLTWH(x, y, 1.25, 1.25), paint);
        } else if (roll > 0.72) {
          paint.color = Color.fromRGBO(
            0,
            0,
            0,
            0.04 + rng.nextDouble() * 0.1,
          );
          canvas.drawRect(Rect.fromLTWH(x, y, 1.25, 1.25), paint);
        }
      }
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
