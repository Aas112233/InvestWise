import 'package:dio/dio.dart';
import 'package:investwise_android/core/constants/api_constants.dart';
import 'package:investwise_android/data/models/project_model.dart';

class ProjectApi {
  final Dio _dio;

  ProjectApi(this._dio);

  // Get all projects
  Future<List<ProjectModel>> getProjects() async {
    try {
      final response = await _dio.get(ApiConstants.projects);
      final List<dynamic> data = (response.data is Map)
          ? response.data['data'] as List<dynamic>
          : response.data as List<dynamic>;
      return data
          .map((json) => ProjectModel.fromJson(json as Map<String, dynamic>))
          .toList();
    } catch (e) {
      throw Exception('Failed to load projects: $e');
    }
  }

  // Get project by ID
  Future<ProjectModel> getProjectById(String id) async {
    try {
      final response = await _dio.get(ApiConstants.projectById(id));
      return ProjectModel.fromJson(response.data as Map<String, dynamic>);
    } catch (e) {
      throw Exception('Failed to load project: $e');
    }
  }

  // Create new project
  Future<ProjectModel> createProject(Map<String, dynamic> data) async {
    try {
      final response = await _dio.post(
        ApiConstants.projects,
        data: data,
      );
      return ProjectModel.fromJson(response.data as Map<String, dynamic>);
    } catch (e) {
      throw Exception('Failed to create project: $e');
    }
  }

  // Update project
  Future<ProjectModel> updateProject(
      String id, Map<String, dynamic> data) async {
    try {
      final response = await _dio.put(
        ApiConstants.projectById(id),
        data: data,
      );
      return ProjectModel.fromJson(response.data as Map<String, dynamic>);
    } catch (e) {
      throw Exception('Failed to update project: $e');
    }
  }

  // Delete project
  Future<void> deleteProject(String id) async {
    try {
      await _dio.delete(ApiConstants.projectById(id));
    } catch (e) {
      throw Exception('Failed to delete project: $e');
    }
  }

  // Add project update (earning/expense)
  Future<ProjectModel> addProjectUpdate(
    String id,
    Map<String, dynamic> updateData,
  ) async {
    try {
      final response = await _dio.post(
        ApiConstants.projectUpdates(id),
        data: updateData,
      );
      return ProjectModel.fromJson(response.data as Map<String, dynamic>);
    } catch (e) {
      throw Exception('Failed to add project update: $e');
    }
  }

  // Edit project update
  Future<ProjectModel> editProjectUpdate(
    String id,
    String updateId,
    Map<String, dynamic> updateData,
  ) async {
    try {
      final response = await _dio.put(
        ApiConstants.projectUpdate(id, updateId),
        data: updateData,
      );
      return ProjectModel.fromJson(response.data as Map<String, dynamic>);
    } catch (e) {
      throw Exception('Failed to edit project update: $e');
    }
  }

  // Delete project update
  Future<ProjectModel> deleteProjectUpdate(String id, String updateId) async {
    try {
      final response = await _dio.delete(
        ApiConstants.projectUpdate(id, updateId),
      );
      return ProjectModel.fromJson(response.data as Map<String, dynamic>);
    } catch (e) {
      throw Exception('Failed to delete project update: $e');
    }
  }
}
