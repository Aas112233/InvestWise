import 'package:dio/dio.dart';
import 'package:investwise_android/core/constants/api_constants.dart';
import 'package:investwise_android/data/models/member_model.dart';

class MemberApi {
  final Dio _dio;

  MemberApi(this._dio);

  Future<List<MemberModel>> getAllMembers() async {
    try {
      final response = await _dio.get(ApiConstants.members);
      final List<dynamic> data =
          response.data is Map ? response.data['data'] : response.data;
      return data.map((json) => MemberModel.fromJson(json)).toList();
    } catch (e) {
      rethrow;
    }
  }

  Future<MemberModel> getMemberById(String id) async {
    try {
      final response = await _dio.get('${ApiConstants.members}/$id');
      return MemberModel.fromJson(response.data);
    } catch (e) {
      rethrow;
    }
  }

  Future<MemberModel> createMember(Map<String, dynamic> memberData) async {
    try {
      final response = await _dio.post(
        ApiConstants.members,
        data: memberData,
      );
      return MemberModel.fromJson(response.data);
    } catch (e) {
      rethrow;
    }
  }

  Future<MemberModel> updateMember(
      String id, Map<String, dynamic> memberData) async {
    try {
      final response = await _dio.put(
        '${ApiConstants.members}/$id',
        data: memberData,
      );
      return MemberModel.fromJson(response.data);
    } catch (e) {
      rethrow;
    }
  }

  Future<void> deleteMember(String id) async {
    try {
      await _dio.delete('${ApiConstants.members}/$id');
    } catch (e) {
      rethrow;
    }
  }
}
