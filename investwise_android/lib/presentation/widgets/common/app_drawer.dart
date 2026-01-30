import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:investwise_android/presentation/providers/auth_provider.dart';
import 'package:investwise_android/core/constants/app_colors.dart';
import 'package:investwise_android/core/constants/app_routes.dart';

class AppDrawer extends StatelessWidget {
  const AppDrawer({super.key});

  @override
  Widget build(BuildContext context) {
    final authProvider = context.watch<AuthProvider>();
    final user = authProvider.currentUser;

    return Drawer(
      child: Column(
        children: [
          // Drawer Header with User Profile
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(vertical: 40, horizontal: 20),
            decoration: const BoxDecoration(
              gradient: LinearGradient(
                colors: [AppColors.primary, AppColors.dark],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
            ),
            child: SafeArea(
              bottom: false,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // User Avatar
                  CircleAvatar(
                    radius: 35,
                    backgroundColor: AppColors.brand,
                    child: Text(
                      user?.name.isNotEmpty == true
                          ? user!.name[0].toUpperCase()
                          : 'U',
                      style: const TextStyle(
                        fontSize: 32,
                        fontWeight: FontWeight.bold,
                        color: AppColors.dark,
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),

                  // User Name
                  Text(
                    user?.name ?? 'User',
                    style: const TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.bold,
                      color: Colors.white,
                    ),
                  ),
                  const SizedBox(height: 4),

                  // User Email
                  Text(
                    user?.email ?? '',
                    style: TextStyle(
                      fontSize: 14,
                      color: Colors.white.withValues(alpha: 0.8),
                    ),
                  ),
                  const SizedBox(height: 8),

                  // User Role Badge
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 4,
                    ),
                    decoration: BoxDecoration(
                      color: AppColors.brand.withValues(alpha: 0.3),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(
                        color: AppColors.brand,
                        width: 1,
                      ),
                    ),
                    child: Text(
                      user?.role ?? 'Member',
                      style: const TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color: AppColors.brand,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),

          // Navigation Menu Items
          Expanded(
            child: ListView(
              padding: EdgeInsets.zero,
              children: [
                _DrawerItem(
                  icon: Icons.dashboard,
                  title: 'Dashboard',
                  onTap: () {
                    Navigator.pop(context);
                    if (ModalRoute.of(context)?.settings.name !=
                        AppRoutes.dashboard) {
                      Navigator.pushReplacementNamed(
                          context, AppRoutes.dashboard);
                    }
                  },
                ),
                _DrawerItem(
                  icon: Icons.people,
                  title: 'Members',
                  onTap: () {
                    Navigator.pop(context);
                    Navigator.pushNamed(context, AppRoutes.members);
                  },
                ),
                _DrawerItem(
                  icon: Icons.account_balance_wallet,
                  title: 'Projects',
                  onTap: () {
                    Navigator.pop(context);
                    Navigator.pushNamed(context, AppRoutes.projects);
                  },
                ),
                _DrawerItem(
                  icon: Icons.receipt_long,
                  title: 'Transactions',
                  onTap: () {
                    Navigator.pop(context);
                    Navigator.pushNamed(context, AppRoutes.transactions);
                  },
                ),
                _DrawerItem(
                  icon: Icons.analytics,
                  title: 'Reports',
                  onTap: () {
                    Navigator.pop(context);
                    // TODO: Navigate to reports
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('Reports - Coming Soon')),
                    );
                  },
                ),
                const Divider(height: 1),
                _DrawerItem(
                  icon: Icons.settings,
                  title: 'Settings',
                  onTap: () {
                    Navigator.pop(context);
                    // TODO: Navigate to settings
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('Settings - Coming Soon')),
                    );
                  },
                ),
              ],
            ),
          ),

          // Logout Button
          Container(
            decoration: const BoxDecoration(
              border: Border(
                top: BorderSide(
                  color: AppColors.grey300,
                  width: 1,
                ),
              ),
            ),
            child: ListTile(
              leading: const Icon(
                Icons.logout,
                color: AppColors.error,
              ),
              title: const Text(
                'Logout',
                style: TextStyle(
                  color: AppColors.error,
                  fontWeight: FontWeight.w600,
                ),
              ),
              onTap: () async {
                Navigator.pop(context);
                await authProvider.logout();
                if (context.mounted) {
                  Navigator.pushReplacementNamed(context, AppRoutes.login);
                }
              },
            ),
          ),

          // App Version
          const Padding(
            padding: EdgeInsets.all(16),
            child: Text(
              'InvestWise v1.0.0',
              style: TextStyle(
                fontSize: 12,
                color: AppColors.grey500,
              ),
              textAlign: TextAlign.center,
            ),
          ),
        ],
      ),
    );
  }
}

class _DrawerItem extends StatelessWidget {
  final IconData icon;
  final String title;
  final VoidCallback onTap;

  const _DrawerItem({
    required this.icon,
    required this.title,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: Icon(
        icon,
        color: AppColors.grey700,
      ),
      title: Text(
        title,
        style: const TextStyle(
          fontSize: 15,
          fontWeight: FontWeight.w500,
          color: AppColors.dark,
        ),
      ),
      onTap: onTap,
      hoverColor: AppColors.brand.withValues(alpha: 0.1),
    );
  }
}
