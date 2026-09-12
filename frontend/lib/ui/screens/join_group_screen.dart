import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../providers/menu_provider.dart';
import '../../providers/session_controller.dart';
import '../../theme.dart';

class JoinGroupScreen extends ConsumerStatefulWidget {
  const JoinGroupScreen({super.key});

  @override
  ConsumerState<JoinGroupScreen> createState() => _JoinGroupScreenState();
}

class _JoinGroupScreenState extends ConsumerState<JoinGroupScreen> {
  final _codeController = TextEditingController();
  final _nameController = TextEditingController();
  bool _joining = false;

  @override
  void dispose() {
    _codeController.dispose();
    _nameController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final code = _codeController.text.trim().toUpperCase();
    final name = _nameController.text.trim();
    if (code.length != 6 || name.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Enter a 6-character code and your display name'),
        ),
      );
      return;
    }
    if (_joining) return;
    setState(() => _joining = true);
    try {
      final joined = await ref.read(apiClientProvider).joinSession(
            joinCode: code,
            displayName: name,
          );
      final sessionId =
          (joined['sessionId'] ?? joined['session_id'])?.toString() ?? '';
      final userId =
          (joined['userId'] ?? joined['user_id'])?.toString() ?? '';
      final joinCode =
          (joined['joinCode'] ?? joined['join_code'] ?? code)?.toString() ??
              code;
      final displayName =
          (joined['displayName'] ?? joined['display_name'] ?? name)
                  ?.toString() ??
              name;
      if (sessionId.isEmpty || userId.isEmpty) {
        throw Exception('Join response missing ids');
      }
      ref.read(sessionControllerProvider).enterSession(
            sessionId: sessionId,
            userId: userId,
            joinCode: joinCode,
            displayName: displayName,
          );
      if (!mounted) return;
      context.go('/group/$sessionId');
    } catch (err) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(content: Text('$err')));
    } finally {
      if (mounted) setState(() => _joining = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          tooltip: 'Back to home',
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.go('/'),
        ),
        title: const Text('Join Group Order'),
      ),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Enter the join code shared by the host.',
              style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                    color: AppTheme.textSecondary,
                  ),
            ),
            const SizedBox(height: 24),
            TextField(
              controller: _codeController,
              textCapitalization: TextCapitalization.characters,
              maxLength: 6,
              enabled: !_joining,
              inputFormatters: [
                FilteringTextInputFormatter.allow(RegExp(r'[A-Za-z0-9]')),
              ],
              decoration: const InputDecoration(
                labelText: 'Join code',
                border: OutlineInputBorder(),
                counterText: '',
              ),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _nameController,
              textCapitalization: TextCapitalization.words,
              enabled: !_joining,
              decoration: const InputDecoration(
                labelText: 'Display name',
                border: OutlineInputBorder(),
              ),
            ),
            const Spacer(),
            FilledButton(
              onPressed: _joining ? null : _submit,
              child: _joining
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Join session'),
            ),
          ],
        ),
      ),
    );
  }
}
