import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/models/menu_item.dart';
import '../data/services/api_client.dart';

final apiClientProvider = Provider<ApiClient>((ref) => ApiClient());

final menuProvider = FutureProvider<List<MenuItem>>((ref) async {
  final client = ref.watch(apiClientProvider);
  return client.fetchMenu();
});
