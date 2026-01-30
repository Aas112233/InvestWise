import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:investwise_android/presentation/providers/member_provider.dart';
import 'package:investwise_android/presentation/screens/members/member_detail_screen.dart';
import 'package:investwise_android/presentation/widgets/common/app_drawer.dart';
import 'package:investwise_android/core/constants/app_colors.dart';
import 'package:investwise_android/core/utils/formatters.dart';
import 'package:investwise_android/domain/entities/member.dart';

class MemberListScreen extends StatefulWidget {
  const MemberListScreen({super.key});

  @override
  State<MemberListScreen> createState() => _MemberListScreenState();
}

class _MemberListScreenState extends State<MemberListScreen> {
  final TextEditingController _searchController = TextEditingController();
  String _selectedStatus = 'All';
  List<Member> _filteredMembers = [];

  @override
  void initState() {
    super.initState();
    Future.microtask(() {
      if (mounted) {
        context.read<MemberProvider>().loadMembers();
      }
    });
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  void _filterMembers(MemberProvider provider) {
    var members = provider.members;

    // Apply status filter
    if (_selectedStatus != 'All') {
      members = provider.filterByStatus(_selectedStatus);
    }

    // Apply search filter
    if (_searchController.text.isNotEmpty) {
      final query = _searchController.text;
      members = members.where((member) {
        final lowercaseQuery = query.toLowerCase();
        return member.name.toLowerCase().contains(lowercaseQuery) ||
            member.email.toLowerCase().contains(lowercaseQuery) ||
            member.memberId.toLowerCase().contains(lowercaseQuery);
      }).toList();
    }

    setState(() {
      _filteredMembers = members;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Members'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () {
              context.read<MemberProvider>().loadMembers();
            },
          ),
        ],
      ),
      drawer: const AppDrawer(),
      body: Consumer<MemberProvider>(
        builder: (context, provider, child) {
          if (provider.isLoading && provider.members.isEmpty) {
            return const Center(child: CircularProgressIndicator());
          }

          if (provider.error != null && provider.members.isEmpty) {
            return Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Icon(
                    Icons.error_outline,
                    size: 64,
                    color: AppColors.error,
                  ),
                  const SizedBox(height: 16),
                  Text(provider.error!),
                  const SizedBox(height: 16),
                  ElevatedButton(
                    onPressed: () => provider.loadMembers(),
                    child: const Text('Retry'),
                  ),
                ],
              ),
            );
          }

          // Update filtered members when provider data changes
          if (_filteredMembers.isEmpty && provider.members.isNotEmpty) {
            WidgetsBinding.instance.addPostFrameCallback((_) {
              _filterMembers(provider);
            });
          }

          return Column(
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
                        hintText: 'Search by name, email, or ID',
                        prefixIcon: const Icon(Icons.search),
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                        ),
                        filled: true,
                        fillColor: AppColors.grey50,
                      ),
                      onChanged: (value) => _filterMembers(provider),
                    ),
                    const SizedBox(height: 12),

                    // Status Filter Chips
                    SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      child: Row(
                        children: ['All', 'Active', 'Inactive', 'Suspended']
                            .map((status) => Padding(
                                  padding: const EdgeInsets.only(right: 8),
                                  child: FilterChip(
                                    label: Text(status),
                                    selected: _selectedStatus == status,
                                    onSelected: (selected) {
                                      setState(() {
                                        _selectedStatus = status;
                                      });
                                      _filterMembers(provider);
                                    },
                                    selectedColor: AppColors.brand,
                                    backgroundColor: AppColors.grey100,
                                  ),
                                ))
                            .toList(),
                      ),
                    ),
                  ],
                ),
              ),

              // Member Count
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                color: AppColors.grey50,
                child: Row(
                  children: [
                    Text(
                      '${_filteredMembers.length} members',
                      style: const TextStyle(
                        color: AppColors.grey600,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ],
                ),
              ),

              // Member List
              Expanded(
                child: _filteredMembers.isEmpty
                    ? const Center(
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(
                              Icons.people_outline,
                              size: 64,
                              color: AppColors.grey400,
                            ),
                            SizedBox(height: 16),
                            Text(
                              'No members found',
                              style: TextStyle(
                                fontSize: 16,
                                color: AppColors.grey600,
                              ),
                            ),
                          ],
                        ),
                      )
                    : RefreshIndicator(
                        onRefresh: () => provider.loadMembers(),
                        child: ListView.separated(
                          padding: const EdgeInsets.all(16),
                          itemCount: _filteredMembers.length,
                          separatorBuilder: (context, index) =>
                              const SizedBox(height: 12),
                          itemBuilder: (context, index) {
                            final member = _filteredMembers[index];
                            return _MemberCard(
                              member: member,
                              onTap: () {
                                Navigator.push(
                                  context,
                                  MaterialPageRoute(
                                    builder: (_) => MemberDetailScreen(
                                      member: member,
                                    ),
                                  ),
                                );
                              },
                            );
                          },
                        ),
                      ),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _MemberCard extends StatelessWidget {
  final Member member;
  final VoidCallback onTap;

  const _MemberCard({
    required this.member,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(16),
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.05),
              blurRadius: 10,
              offset: const Offset(0, 4),
            ),
          ],
        ),
        child: Row(
          children: [
            // Avatar
            CircleAvatar(
              radius: 28,
              backgroundColor: AppColors.brand.withValues(alpha: 0.2),
              child: Text(
                member.name.isNotEmpty ? member.name[0].toUpperCase() : 'M',
                style: const TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.bold,
                  color: AppColors.dark,
                ),
              ),
            ),
            const SizedBox(width: 16),

            // Member Info
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    member.name,
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.bold,
                      color: AppColors.dark,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    member.role,
                    style: const TextStyle(
                      fontSize: 13,
                      color: AppColors.grey600,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      const Icon(
                        Icons.account_balance_wallet,
                        size: 14,
                        color: AppColors.grey500,
                      ),
                      const SizedBox(width: 4),
                      Text(
                        '${member.shares} shares',
                        style: const TextStyle(
                          fontSize: 12,
                          color: AppColors.grey500,
                        ),
                      ),
                      const SizedBox(width: 12),
                      const Icon(
                        Icons.attach_money,
                        size: 14,
                        color: AppColors.grey500,
                      ),
                      Text(
                        AppFormatters.formatCompactNumber(
                            member.totalContributed),
                        style: const TextStyle(
                          fontSize: 12,
                          color: AppColors.grey500,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),

            // Status Badge
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              decoration: BoxDecoration(
                color: _getStatusColor(member.status).withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(20),
                border: Border.all(
                  color: _getStatusColor(member.status).withValues(alpha: 0.3),
                ),
              ),
              child: Text(
                member.status,
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                  color: _getStatusColor(member.status),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Color _getStatusColor(String status) {
    switch (status.toLowerCase()) {
      case 'active':
        return AppColors.success;
      case 'inactive':
        return AppColors.grey500;
      case 'suspended':
        return AppColors.error;
      default:
        return AppColors.grey500;
    }
  }
}
