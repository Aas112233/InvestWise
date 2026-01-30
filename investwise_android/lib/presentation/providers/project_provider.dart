import 'package:flutter/foundation.dart';
import 'package:investwise_android/domain/entities/project.dart';
import 'package:investwise_android/data/datasources/remote/project_api.dart';

class ProjectProvider with ChangeNotifier {
  final ProjectApi _projectApi;

  List<Project> _projects = [];
  Project? _selectedProject;
  bool _isLoading = false;
  String? _error;
  String _searchQuery = '';
  String? _statusFilter;
  String? _healthFilter;

  ProjectProvider({required ProjectApi projectApi}) : _projectApi = projectApi;

  // Getters
  List<Project> get projects => _filteredProjects;
  Project? get selectedProject => _selectedProject;
  bool get isLoading => _isLoading;
  String? get error => _error;
  String get searchQuery => _searchQuery;
  String? get statusFilter => _statusFilter;
  String? get healthFilter => _healthFilter;

  // Computed filtered projects
  List<Project> get _filteredProjects {
    var filtered = _projects;

    // Apply search filter
    if (_searchQuery.isNotEmpty) {
      filtered = filtered
          .where((project) =>
              project.title
                  .toLowerCase()
                  .contains(_searchQuery.toLowerCase()) ||
              project.category
                  .toLowerCase()
                  .contains(_searchQuery.toLowerCase()) ||
              project.description
                  .toLowerCase()
                  .contains(_searchQuery.toLowerCase()))
          .toList();
    }

    // Apply status filter
    if (_statusFilter != null) {
      filtered =
          filtered.where((project) => project.status == _statusFilter).toList();
    }

    // Apply health filter
    if (_healthFilter != null) {
      filtered =
          filtered.where((project) => project.health == _healthFilter).toList();
    }

    return filtered;
  }

  // Load all projects
  Future<void> loadProjects() async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final projectModels = await _projectApi.getProjects();
      _projects = projectModels.map((model) => model.toEntity()).toList();
      _error = null;
    } catch (e) {
      _error = 'Failed to load projects: ${e.toString()}';
      _projects = [];
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  // Load project by ID
  Future<void> loadProjectById(String id) async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final projectModel = await _projectApi.getProjectById(id);
      _selectedProject = projectModel.toEntity();
      _error = null;
    } catch (e) {
      _error = 'Failed to load project: ${e.toString()}';
      _selectedProject = null;
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  // Create new project
  Future<bool> createProject(Map<String, dynamic> data) async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final projectModel = await _projectApi.createProject(data);
      _projects.add(projectModel.toEntity());
      _error = null;
      _isLoading = false;
      notifyListeners();
      return true;
    } catch (e) {
      _error = 'Failed to create project: ${e.toString()}';
      _isLoading = false;
      notifyListeners();
      return false;
    }
  }

  // Update project
  Future<bool> updateProject(String id, Map<String, dynamic> data) async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final projectModel = await _projectApi.updateProject(id, data);
      final index = _projects.indexWhere((p) => p.id == id);
      if (index != -1) {
        _projects[index] = projectModel.toEntity();
      }
      if (_selectedProject?.id == id) {
        _selectedProject = projectModel.toEntity();
      }
      _error = null;
      _isLoading = false;
      notifyListeners();
      return true;
    } catch (e) {
      _error = 'Failed to update project: ${e.toString()}';
      _isLoading = false;
      notifyListeners();
      return false;
    }
  }

  // Delete project
  Future<bool> deleteProject(String id) async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      await _projectApi.deleteProject(id);
      _projects.removeWhere((p) => p.id == id);
      if (_selectedProject?.id == id) {
        _selectedProject = null;
      }
      _error = null;
      _isLoading = false;
      notifyListeners();
      return true;
    } catch (e) {
      _error = 'Failed to delete project: ${e.toString()}';
      _isLoading = false;
      notifyListeners();
      return false;
    }
  }

  // Add Project Update (Earning/Expense)
  Future<bool> addProjectUpdate(String id, Map<String, dynamic> data) async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final projectModel = await _projectApi.addProjectUpdate(id, data);
      final index = _projects.indexWhere((p) => p.id == id);
      if (index != -1) {
        _projects[index] = projectModel.toEntity();
      }
      if (_selectedProject?.id == id) {
        _selectedProject = projectModel.toEntity();
      }
      _error = null;
      _isLoading = false;
      notifyListeners();
      return true;
    } catch (e) {
      _error = 'Failed to add project update: ${e.toString()}';
      _isLoading = false;
      notifyListeners();
      return false;
    }
  }

  // Search projects
  void searchProjects(String query) {
    _searchQuery = query;
    notifyListeners();
  }

  // Filter by status
  void filterByStatus(String? status) {
    _statusFilter = status;
    notifyListeners();
  }

  // Filter by health
  void filterByHealth(String? health) {
    _healthFilter = health;
    notifyListeners();
  }

  // Clear filters
  void clearFilters() {
    _searchQuery = '';
    _statusFilter = null;
    _healthFilter = null;
    notifyListeners();
  }

  // Clear selected project
  void clearSelectedProject() {
    _selectedProject = null;
    notifyListeners();
  }
}
