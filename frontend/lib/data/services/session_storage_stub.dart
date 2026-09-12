class SessionStorageImpl {
  static String? _memoryStorage;

  static String? loadRaw() => _memoryStorage;

  static void saveRaw(String value) {
    _memoryStorage = value;
  }

  static void clear() {
    _memoryStorage = null;
  }
}
