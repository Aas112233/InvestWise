import 'package:dio/dio.dart';
import 'package:investwise_android/core/constants/api_constants.dart';
import 'package:investwise_android/data/models/user_model.dart';

class AuthApi {
  final Dio _dio;

  AuthApi(this._dio);

  Future<LoginResponse> login({
    required String email,
    required String password,
  }) async {
    try {
      final response = await _dio.post(
        ApiConstants.login,
        data: {
          'email': email,
          'password': password,
        },
      );

      return LoginResponse.fromJson(response.data);
    } catch (e) {
      rethrow;
    }
  }

  Future<UserModel> getProfile() async {
    try {
      final response = await _dio.get(ApiConstants.profile);
      return UserModel.fromJson(response.data);
    } catch (e) {
      rethrow;
    }
  }
}
