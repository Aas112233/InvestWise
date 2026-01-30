class ApiConstants {
  // Base URL - Update this with your server IP
  static const String baseUrl = 'http://10.55.13.171:5000/api';

  // Auth Endpoints
  static const String login = '/auth/login';
  static const String profile = '/auth/profile';

  // Member Endpoints
  static const String members = '/members';

  // Project Endpoints
  static const String projects = '/projects';

  // Fund Endpoints
  static const String funds = '/funds';

  // Finance Endpoints
  static const String transactions = '/finance/transactions';
  static const String deposits = '/finance/deposits';
  static const String expenses = '/finance/expenses';

  // Analytics Endpoints
  static const String analyticsStats = '/analytics/stats';
  static const String analyticsRecalculate = '/analytics/recalculate';

  // Helper methods for dynamic endpoints
  static String memberById(String id) => '/members/$id';
  static String projectById(String id) => '/projects/$id';
  static String projectUpdates(String id) => '/projects/$id/updates';
  static String projectUpdate(String id, String updateId) =>
      '/projects/$id/updates/$updateId';

  // Timeouts
  static const Duration connectTimeout = Duration(seconds: 30);
  static const Duration receiveTimeout = Duration(seconds: 30);
}
