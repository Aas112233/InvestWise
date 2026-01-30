import 'package:flutter/material.dart';
import 'package:investwise_android/domain/entities/global_stats.dart';
import 'package:investwise_android/data/datasources/remote/analytics_api.dart';

class DashboardProvider with ChangeNotifier {
  final AnalyticsApi _analyticsApi;

  GlobalStats? _stats;
  bool _isLoading = false;
  String? _error;

  GlobalStats? get stats => _stats;
  bool get isLoading => _isLoading;
  String? get error => _error;

  DashboardProvider({required AnalyticsApi analyticsApi})
      : _analyticsApi = analyticsApi;

  Future<void> loadStats() async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final statsModel = await _analyticsApi.getStats();
      _stats = statsModel.toEntity();
      _error = null;
    } catch (e) {
      _error = 'Failed to load stats: ${e.toString()}';
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<void> recalculateStats() async {
    try {
      await _analyticsApi.recalculateStats();
      await loadStats();
    } catch (e) {
      _error = 'Failed to recalculate stats: ${e.toString()}';
      notifyListeners();
    }
  }
}
