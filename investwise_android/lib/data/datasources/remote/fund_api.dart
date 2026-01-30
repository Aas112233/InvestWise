import 'package:dio/dio.dart';
import 'package:investwise_android/core/constants/api_constants.dart';
import 'package:investwise_android/data/models/fund_model.dart';

class FundApi {
  final Dio _dio;

  FundApi(this._dio);

  Future<List<FundModel>> getFunds() async {
    try {
      final response = await _dio.get(ApiConstants.funds);
      if (response.statusCode == 200) {
        final List<dynamic> data = response.data;
        return data.map((json) => FundModel.fromJson(json)).toList();
      }
      throw Exception('Failed to load funds');
    } catch (e) {
      rethrow;
    }
  }

  Future<FundModel> createFund(Map<String, dynamic> data) async {
    try {
      final response = await _dio.post(ApiConstants.funds, data: data);
      if (response.statusCode == 201) {
        return FundModel.fromJson(response.data);
      }
      throw Exception('Failed to create fund');
    } catch (e) {
      rethrow;
    }
  }
}
