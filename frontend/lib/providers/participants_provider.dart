import 'package:flutter_riverpod/flutter_riverpod.dart';

class Participant {
  const Participant({
    required this.userId,
    required this.name,
    required this.ready,
    this.isHost = false,
  });

  final String userId;
  final String name;
  final bool ready;
  final bool isHost;
}

class ParticipantsNotifier extends StateNotifier<List<Participant>> {
  ParticipantsNotifier() : super(const []);

  void setAll(List<Participant> next) {
    state = List.unmodifiable(next);
  }

  void clear() {
    state = const [];
  }
}

final participantsProvider =
    StateNotifierProvider<ParticipantsNotifier, List<Participant>>((ref) {
  return ParticipantsNotifier();
});
