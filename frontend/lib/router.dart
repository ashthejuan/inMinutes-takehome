import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import 'ui/screens/cart_screen.dart';
import 'ui/screens/collaborative_cart_screen.dart';
import 'ui/screens/home_screen.dart';
import 'ui/screens/join_group_screen.dart';
import 'ui/screens/menu_screen.dart';
import 'ui/screens/order_success_screen.dart';

final appRouter = GoRouter(
  initialLocation: '/',
  routes: [
    GoRoute(
      path: '/',
      builder: (context, state) => const HomeScreen(),
    ),
    GoRoute(
      path: '/menu',
      builder: (context, state) => const MenuScreen(),
    ),
    GoRoute(
      path: '/cart',
      builder: (context, state) => const CartScreen(),
    ),
    GoRoute(
      path: '/group/join',
      builder: (context, state) => const JoinGroupScreen(),
    ),
    GoRoute(
      path: '/group/:sessionId',
      builder: (context, state) {
        final sessionId = state.pathParameters['sessionId'] ?? '';
        return CollaborativeCartScreen(sessionId: sessionId);
      },
    ),
    GoRoute(
      path: '/order/:orderId/success',
      builder: (context, state) {
        final orderId = state.pathParameters['orderId'] ?? '';
        return OrderSuccessScreen(orderId: orderId);
      },
    ),
  ],
  errorBuilder: (context, state) => Scaffold(
    body: Center(child: Text('Route not found: ${state.uri}')),
  ),
);
