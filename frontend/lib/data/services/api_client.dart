import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../config.dart';
import '../models/menu_item.dart';

class ApiClient {
  ApiClient({http.Client? client, String? baseUrl})
      : _client = client ?? http.Client(),
        _baseUrl = baseUrl ?? apiBaseUrl;

  final http.Client _client;
  final String _baseUrl;

  Future<List<MenuItem>> fetchMenu() async {
    final uri = Uri.parse('$_baseUrl/api/menu');
    final response = await _client.get(uri);
    if (response.statusCode != 200) {
      throw Exception('Failed to load menu (${response.statusCode})');
    }
    final decoded = jsonDecode(response.body);
    if (decoded is! List) {
      throw Exception('Unexpected menu payload');
    }
    return decoded
        .whereType<Map<String, dynamic>>()
        .map(MenuItem.fromJson)
        .toList(growable: false);
  }

  /// Host creates a group session → `{ sessionId, joinCode, hostId }`.
  Future<Map<String, dynamic>> createSession({String? displayName}) async {
    final uri = Uri.parse('$_baseUrl/api/sessions');
    final response = await _client.post(
      uri,
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        if (displayName != null && displayName.isNotEmpty)
          'displayName': displayName,
      }),
    );
    if (response.statusCode != 201) {
      throw Exception(_errorMessage(response, 'Failed to create session'));
    }
    return _requireMap(response.body);
  }

  /// Guest joins via join code → `{ sessionId, userId, displayName, joinCode }`.
  Future<Map<String, dynamic>> joinSession({
    required String joinCode,
    required String displayName,
  }) async {
    final uri = Uri.parse('$_baseUrl/api/sessions/join');
    final response = await _client.post(
      uri,
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'joinCode': joinCode,
        'displayName': displayName,
      }),
    );
    if (response.statusCode != 200) {
      throw Exception(_errorMessage(response, 'Failed to join session'));
    }
    return _requireMap(response.body);
  }

  Future<bool> healthCheck() async {
    final uri = Uri.parse('$_baseUrl/health');
    final response = await _client.get(uri);
    return response.statusCode == 200;
  }

  Map<String, dynamic> _requireMap(String body) {
    final decoded = jsonDecode(body);
    if (decoded is! Map) {
      throw Exception('Unexpected session payload');
    }
    return Map<String, dynamic>.from(decoded);
  }

  String _errorMessage(http.Response response, String fallback) {
    try {
      final decoded = jsonDecode(response.body);
      if (decoded is Map) {
        final message = decoded['message'] ?? decoded['error'];
        if (message is String && message.isNotEmpty) return message;
      }
    } catch (_) {
      // fall through
    }
    return '$fallback (${response.statusCode})';
  }
}
