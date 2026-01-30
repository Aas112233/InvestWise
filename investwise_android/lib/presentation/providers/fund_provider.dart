import 'package:flutter/foundation.dart';
import 'package:investwise_android/domain/entities/fund.dart';
import 'package:investwise_android/data/datasources/remote/fund_api.dart';

class FundProvider with ChangeNotifier {
  final FundApi _fundApi;
  List<Fund> _funds = [];
  bool _isLoading = false;
  String? _error;

  FundProvider({required FundApi fundApi}) : _fundApi = fundApi;

  List<Fund> get funds => _funds;
  bool get isLoading => _isLoading;
  String? get error => _error;

  List<Fund> get activeFunds => _funds.where((f) => f.isActive).toList();
  List<Fund> get depositFunds => _funds.where((f) => f.isDepositFund).toList();

  Future<void> loadFunds() async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final fundModels = await _fundApi.getFunds();
      _funds = fundModels.map((model) => model.toEntity()).toList();
    } catch (e) {
      _error = 'Failed to load funds: ${e.toString()}';
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Fund? getFundById(String id) {
    try {
      return _funds.firstWhere((f) => f.id == id);
    } catch (_) {
      return null;
    }
  }
}
