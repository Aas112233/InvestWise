import 'package:flutter/foundation.dart';
import 'package:investwise_android/core/network/dio_client.dart';
import 'package:investwise_android/domain/entities/user.dart';
import 'package:investwise_android/data/datasources/remote/auth_api.dart';

class AuthProvider with ChangeNotifier {
  final AuthApi _authApi;
  final DioClient _dioClient;

  User? _currentUser;
  bool _isLoading = false;
  String? _error;

  User? get currentUser => _currentUser;
  bool get isLoading => _isLoading;
  String? get error => _error;
  bool get isAuthenticated => _currentUser != null;

  AuthProvider({
    required AuthApi authApi,
    required DioClient dioClient,
  })  : _authApi = authApi,
        _dioClient = dioClient;

  Future<bool> login(String email, String password) async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final response = await _authApi.login(
        email: email,
        password: password,
      );

      // Save token
      await _dioClient.setAuthToken(response.token);

      // Set current user
      _currentUser = response.user.toEntity();

      _isLoading = false;
      notifyListeners();
      return true;
    } catch (e) {
      _error = e.toString();
      _isLoading = false;
      notifyListeners();
      return false;
    }
  }

  Future<void> logout() async {
    await _dioClient.clearAuthToken();
    _currentUser = null;
    notifyListeners();
  }

  Future<void> checkAuth() async {
    final token = await _dioClient.getAuthToken();
    if (token != null) {
      try {
        final user = await _authApi.getProfile();
        _currentUser = user.toEntity();
        notifyListeners();
      } catch (e) {
        await logout();
      }
    }
  }
}
