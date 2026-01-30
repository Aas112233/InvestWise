import 'package:flutter/foundation.dart';
import 'package:investwise_android/domain/entities/member.dart';
import 'package:investwise_android/data/datasources/remote/member_api.dart';

class MemberProvider with ChangeNotifier {
  final MemberApi _memberApi;

  List<Member> _members = [];
  bool _isLoading = false;
  String? _error;

  List<Member> get members => _members;
  bool get isLoading => _isLoading;
  String? get error => _error;

  MemberProvider({required MemberApi memberApi}) : _memberApi = memberApi;

  Future<void> loadMembers() async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final memberModels = await _memberApi.getAllMembers();
      _members = memberModels.map((model) => model.toEntity()).toList();
      _error = null;
    } catch (e) {
      _error = 'Failed to load members: ${e.toString()}';
      _members = [];
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  List<Member> searchMembers(String query) {
    if (query.isEmpty) return _members;

    final lowercaseQuery = query.toLowerCase();
    return _members.where((member) {
      return member.name.toLowerCase().contains(lowercaseQuery) ||
          member.email.toLowerCase().contains(lowercaseQuery) ||
          member.memberId.toLowerCase().contains(lowercaseQuery);
    }).toList();
  }

  List<Member> filterByStatus(String status) {
    if (status == 'All') return _members;
    return _members.where((member) => member.status == status).toList();
  }
}
