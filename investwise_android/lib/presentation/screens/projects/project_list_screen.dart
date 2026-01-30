import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:investwise_android/presentation/providers/project_provider.dart';
import 'package:investwise_android/presentation/widgets/common/app_drawer.dart';
import 'package:investwise_android/presentation/widgets/projects/project_card.dart';
import 'package:investwise_android/core/constants/app_colors.dart';
import 'package:investwise_android/core/constants/app_routes.dart';

class ProjectListScreen extends StatefulWidget {
  const ProjectListScreen({super.key});

  @override
  State<ProjectListScreen> createState() => _ProjectListScreenState();
}

class _ProjectListScreenState extends State<ProjectListScreen> {
  final TextEditingController _searchController = TextEditingController();

  @override
  void initState() {
    super.initState();
    Future.microtask(() {
      if (!mounted) return;
      context.read<ProjectProvider>().loadProjects();
    });
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Projects'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () {
              context.read<ProjectProvider>().loadProjects();
            },
          ),
        ],
      ),
      drawer: const AppDrawer(),
      body: Column(
        children: [
          // Search and Filter Section
          Container(
            padding: const EdgeInsets.all(16),
            color: Colors.white,
            child: Column(
              children: [
                // Search Bar
                TextField(
                  controller: _searchController,
                  decoration: InputDecoration(
                    hintText: 'Search projects...',
                    prefixIcon: const Icon(Icons.search),
                    suffixIcon: _searchController.text.isNotEmpty
                        ? IconButton(
                            icon: const Icon(Icons.clear),
                            onPressed: () {
                              _searchController.clear();
                              context
                                  .read<ProjectProvider>()
                                  .searchProjects('');
                            },
                          )
                        : null,
                    filled: true,
                    fillColor: AppColors.grey50,
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(12),
                      borderSide: BorderSide.none,
                    ),
                    contentPadding: const EdgeInsets.symmetric(horizontal: 16),
                  ),
                  onChanged: (value) {
                    context.read<ProjectProvider>().searchProjects(value);
                  },
                ),
                const SizedBox(height: 12),
                // Filter Chips
                SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Consumer<ProjectProvider>(
                    builder: (context, provider, _) {
                      return Row(
                        children: [
                          _FilterChip(
                            label: 'All',
                            isSelected: provider.statusFilter == null,
                            onSelected: (_) => provider.filterByStatus(null),
                          ),
                          const SizedBox(width: 8),
                          _FilterChip(
                            label: 'In Progress',
                            isSelected: provider.statusFilter == 'In Progress',
                            onSelected: (selected) => provider.filterByStatus(
                                selected ? 'In Progress' : null),
                          ),
                          const SizedBox(width: 8),
                          _FilterChip(
                            label: 'Completed',
                            isSelected: provider.statusFilter == 'Completed',
                            onSelected: (selected) => provider
                                .filterByStatus(selected ? 'Completed' : null),
                          ),
                          const SizedBox(width: 8),
                          _FilterChip(
                            label: 'Stable',
                            isSelected: provider.healthFilter == 'Stable',
                            onSelected: (selected) => provider
                                .filterByHealth(selected ? 'Stable' : null),
                          ),
                          const SizedBox(width: 8),
                          _FilterChip(
                            label: 'At Risk',
                            isSelected: provider.healthFilter == 'At Risk',
                            onSelected: (selected) => provider
                                .filterByHealth(selected ? 'At Risk' : null),
                          ),
                        ],
                      );
                    },
                  ),
                ),
              ],
            ),
          ),

          // Project List
          Expanded(
            child: Consumer<ProjectProvider>(
              builder: (context, provider, child) {
                if (provider.isLoading && provider.projects.isEmpty) {
                  return const Center(child: CircularProgressIndicator());
                }

                if (provider.error != null && provider.projects.isEmpty) {
                  return Center(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        const Icon(
                          Icons.error_outline,
                          size: 48,
                          color: AppColors.error,
                        ),
                        const SizedBox(height: 16),
                        Text(provider.error!),
                        const SizedBox(height: 16),
                        ElevatedButton(
                          onPressed: () => provider.loadProjects(),
                          child: const Text('Retry'),
                        ),
                      ],
                    ),
                  );
                }

                if (provider.projects.isEmpty) {
                  return const Center(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(
                          Icons.folder_open,
                          size: 64,
                          color: AppColors.grey300,
                        ),
                        SizedBox(height: 16),
                        Text(
                          'No projects found',
                          style: TextStyle(
                            fontSize: 16,
                            color: AppColors.grey500,
                          ),
                        ),
                      ],
                    ),
                  );
                }

                return RefreshIndicator(
                  onRefresh: () => provider.loadProjects(),
                  child: ListView.separated(
                    padding: const EdgeInsets.all(16),
                    itemCount: provider.projects.length,
                    separatorBuilder: (context, index) =>
                        const SizedBox(height: 16),
                    itemBuilder: (context, index) {
                      final project = provider.projects[index];
                      return ProjectCard(
                        project: project,
                        onTap: () {
                          Navigator.pushNamed(
                            context,
                            AppRoutes.projectDetail,
                            arguments: project,
                          );
                        },
                      );
                    },
                  ),
                );
              },
            ),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () => Navigator.pushNamed(context, AppRoutes.addProject),
        backgroundColor: AppColors.brand,
        child: const Icon(Icons.add, color: AppColors.dark),
      ),
    );
  }
}

class _FilterChip extends StatelessWidget {
  final String label;
  final bool isSelected;
  final Function(bool) onSelected;

  const _FilterChip({
    required this.label,
    required this.isSelected,
    required this.onSelected,
  });

  @override
  Widget build(BuildContext context) {
    return FilterChip(
      label: Text(label),
      selected: isSelected,
      onSelected: onSelected,
      backgroundColor: Colors.white,
      selectedColor: AppColors.brand.withValues(alpha: 0.2),
      checkmarkColor: AppColors.dark,
      labelStyle: TextStyle(
        color: isSelected ? AppColors.dark : AppColors.grey700,
        fontWeight: isSelected ? FontWeight.w600 : FontWeight.normal,
      ),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(20),
        side: BorderSide(
          color: isSelected ? AppColors.brand : AppColors.grey300,
        ),
      ),
    );
  }
}
