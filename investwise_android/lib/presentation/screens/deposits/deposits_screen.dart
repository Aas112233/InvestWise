import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:investwise_android/core/constants/app_colors.dart';
import 'package:investwise_android/core/constants/app_routes.dart';
import 'package:investwise_android/presentation/providers/transaction_provider.dart';
import 'package:investwise_android/presentation/widgets/common/app_drawer.dart';
import 'package:investwise_android/presentation/widgets/transactions/transaction_card.dart';

class DepositsScreen extends StatefulWidget {
  const DepositsScreen({super.key});

  @override
  State<DepositsScreen> createState() => _DepositsScreenState();
}

class _DepositsScreenState extends State<DepositsScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _tabController.addListener(_handleTabChange);

    Future.microtask(() {
      if (!mounted) return;
      context.read<TransactionProvider>().setTypeFilter('Deposit');
      context.read<TransactionProvider>().loadTransactions();
    });
  }

  void _handleTabChange() {
    if (_tabController.indexIsChanging) return;
    
    // Logic for additional status filtering can be added here if provider supports it
    // For now, checks are done in the UI list generation or we can add setStatusFilter to provider
    setState(() {});
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Deposits'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () {
              context.read<TransactionProvider>().loadTransactions();
            },
          ),
        ],
        bottom: TabBar(
          controller: _tabController,
          labelColor: Colors.white,
          unselectedLabelColor: Colors.white.withOpacity(0.6),
          indicatorColor: AppColors.brand,
          indicatorWeight: 3,
          tabs: const [
            Tab(text: 'All Deposits'),
            Tab(text: 'Pending'),
          ],
        ),
      ),
      drawer: const AppDrawer(),
      body: Consumer<TransactionProvider>(
        builder: (context, provider, child) {
          if (provider.isLoading && provider.transactions.isEmpty) {
            return const Center(child: CircularProgressIndicator());
          }

          if (provider.error != null && provider.transactions.isEmpty) {
            return Center(child: Text(provider.error!));
          }

          // Filter transactions locally based on tab
          final allDeposits = provider.transactions
              .where((t) => t.type == 'Deposit')
              .toList();
          
          final pendingDeposits = allDeposits
              .where((t) => t.status == 'Pending')
              .toList();

          final displayedTransactions = _tabController.index == 0
              ? allDeposits
              : pendingDeposits;

          if (displayedTransactions.isEmpty) {
            return Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                   Icon(
                    Icons.account_balance_wallet_outlined,
                    size: 64,
                    color: AppColors.grey400,
                  ),
                  const SizedBox(height: 16),
                  Text(
                    _tabController.index == 0
                        ? 'No deposits found'
                        : 'No pending deposits',
                    style: const TextStyle(
                      fontSize: 16,
                      color: AppColors.grey500,
                    ),
                  ),
                ],
              ),
            );
          }

          return RefreshIndicator(
            onRefresh: () => provider.loadTransactions(),
            child: ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: displayedTransactions.length,
              separatorBuilder: (context, index) =>
                  const SizedBox(height: 16),
              itemBuilder: (context, index) {
                return TransactionCard(
                  transaction: displayedTransactions[index],
                );
              },
            ),
          );
        },
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () =>
            Navigator.pushNamed(context, AppRoutes.requestDeposit),
        backgroundColor: AppColors.brand,
        child: const Icon(Icons.add, color: AppColors.dark),
        tooltip: 'Request Deposit',
      ),
    );
  }
}
