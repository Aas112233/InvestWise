import 'package:flutter/foundation.dart';
import 'package:investwise_android/domain/entities/transaction.dart';
import 'package:investwise_android/data/datasources/remote/finance_api.dart';

class TransactionProvider with ChangeNotifier {
  final FinanceApi _financeApi;

  List<Transaction> _transactions = [];
  bool _isLoading = false;
  String? _error;
  String _searchQuery = '';
  String? _typeFilter; // 'Inflow', 'Outflow', null for All

  TransactionProvider({required FinanceApi financeApi})
      : _financeApi = financeApi;

  // Getters
  List<Transaction> get transactions => _filteredTransactions;
  bool get isLoading => _isLoading;
  String? get error => _error;
  String get searchQuery => _searchQuery;
  String? get typeFilter => _typeFilter;

  // Computed filtered list
  List<Transaction> get _filteredTransactions {
    var filtered = _transactions;

    if (_searchQuery.isNotEmpty) {
      filtered = filtered
          .where((t) =>
              t.description
                  .toLowerCase()
                  .contains(_searchQuery.toLowerCase()) ||
              (t.category?.toLowerCase().contains(_searchQuery.toLowerCase()) ??
                  false))
          .toList();
    }

    if (_typeFilter == 'Inflow') {
      filtered = filtered.where((t) => t.isInflow).toList();
    } else if (_typeFilter == 'Outflow') {
      filtered = filtered.where((t) => t.isOutflow).toList();
    }

    // Sort by date descending
    filtered.sort((a, b) => b.date.compareTo(a.date));

    return filtered;
  }

  // Load transactions
  Future<void> loadTransactions() async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final models = await _financeApi.getTransactions();
      _transactions = models.map((m) => m.toEntity()).toList();
      _error = null;
    } catch (e) {
      _error = 'Failed to load transactions: ${e.toString()}';
      _transactions = [];
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  // Add filters
  void setSearchQuery(String query) {
    _searchQuery = query;
    notifyListeners();
  }

  void setTypeFilter(String? type) {
    _typeFilter = type;
    notifyListeners();
  }

  // Create Transactions
  Future<bool> addDeposit(Map<String, dynamic> data) async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final model = await _financeApi.addDeposit(data);
      _transactions.insert(0, model.toEntity());
      _error = null;
      return true;
    } catch (e) {
      _error = 'Deposit failed: ${e.toString()}';
      return false;
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<bool> addExpense(Map<String, dynamic> data) async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final model = await _financeApi.addExpense(data);
      _transactions.insert(0, model.toEntity());
      _error = null;
      return true;
    } catch (e) {
      _error = 'Expense failed: ${e.toString()}';
      return false;
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<bool> deleteTransaction(String id) async {
    try {
      await _financeApi.deleteTransaction(id);
      _transactions.removeWhere((t) => t.id == id);
      notifyListeners();
      return true;
    } catch (e) {
      _error = 'Delete failed: ${e.toString()}';
      notifyListeners();
      return false;
    }
  }
}
