import 'package:dio/dio.dart';
import 'package:investwise_android/core/constants/api_constants.dart';
import 'package:investwise_android/data/models/global_stats_model.dart';

class AnalyticsApi {
  final Dio _dio;

  AnalyticsApi(this._dio);

  Future<GlobalStatsModel> getStats() async {
    try {
      final response = await _dio.get(ApiConstants.analyticsStats);
      return GlobalStatsModel.fromJson(response.data);
    } catch (e) {
      rethrow;
    }
  }

  Future<void> recalculateStats() async {
    try {
      await _dio.post(ApiConstants.analyticsRecalculate);
    } catch (e) {
      rethrow;
    }
  }
}
