import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:food_order/main.dart';

void main() {
  testWidgets('Home screen shows brand and order actions', (tester) async {
    await tester.pumpWidget(const ProviderScope(child: FoodOrderApp()));
    await tester.pumpAndSettle();

    expect(find.text('inMinutes'), findsOneWidget);
    expect(find.text('Normal Order'), findsOneWidget);
    expect(find.text('Join Group Order'), findsOneWidget);
  });
}
