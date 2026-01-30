import 'package:dio/dio.dart';
import 'package:investwise_android/core/constants/api_constants.dart';
import 'package:investwise_android/data/models/transaction_model.dart';

class FinanceApi {
  final Dio _dio;

  FinanceApi(this._dio);

  // Get all transactions
  Future<List<TransactionModel>> getTransactions() async {
    try {
      final response = await _dio.get(ApiConstants.transactions);
      final List<dynamic> data = (response.data is Map)
          ? response.data['data'] as List<dynamic>
          : response.data as List<dynamic>;
      return data
          .map(
              (json) => TransactionModel.fromJson(json as Map<String, dynamic>))
          .toList();
    } catch (e) {
      throw Exception('Failed to load transactions: $e');
    }
  }

  // Create deposit
  Future<TransactionModel> addDeposit(Map<String, dynamic> data) async {
    try {
      final response = await _dio.post(ApiConstants.deposits, data: data);
      return TransactionModel.fromJson(response.data as Map<String, dynamic>);
    } catch (e) {
      throw Exception('Failed to create deposit: $e');
    }
  }

  // Create expense
  Future<TransactionModel> addExpense(Map<String, dynamic> data) async {
    try {
      final response = await _dio.post(ApiConstants.expenses, data: data);
      return TransactionModel.fromJson(response.data as Map<String, dynamic>);
    } catch (e) {
      throw Exception('Failed to create expense: $e');
    }
  }

  // Delete transaction
  Future<void> deleteTransaction(String id) async {
    try {
      await _dio.delete('${ApiConstants.transactions}/$id');
    } catch (e) {
      throw Exception('Failed to delete transaction: $e');
    }
  }
}
