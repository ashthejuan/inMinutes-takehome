import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'participants_provider.dart';
import 'session_provider.dart';

class CheckoutState {
  const CheckoutState({
    required this.isHost,
    required this.allReady,
  });

  final bool isHost;
  final bool allReady;

  bool get canCheckout => isHost && allReady;
}

final checkoutProvider = Provider<CheckoutState>((ref) {
  final session = ref.watch(sessionProvider);
  final participants = ref.watch(participantsProvider);
  final allReady =
      participants.isNotEmpty && participants.every((p) => p.ready);
  return CheckoutState(isHost: session.isHost, allReady: allReady);
});
