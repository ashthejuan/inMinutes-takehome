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

  Future<bool> healthCheck() async {
    final uri = Uri.parse('$_baseUrl/health');
    final response = await _client.get(uri);
    return response.statusCode == 200;
  }
}
