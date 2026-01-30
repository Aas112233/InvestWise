import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:investwise_android/core/constants/app_colors.dart';
import 'package:investwise_android/core/constants/app_routes.dart';
import 'package:investwise_android/presentation/providers/transaction_provider.dart';
import 'package:investwise_android/presentation/widgets/common/app_drawer.dart';
import 'package:investwise_android/presentation/widgets/transactions/transaction_card.dart';

class TransactionListScreen extends StatefulWidget {
  const TransactionListScreen({super.key});

  @override
  State<TransactionListScreen> createState() => _TransactionListScreenState();
}

class _TransactionListScreenState extends State<TransactionListScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  final TextEditingController _searchController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 3, vsync: this);
    _tabController.addListener(_handleTabChange);

    Future.microtask(() {
      if (!mounted) return;
      context.read<TransactionProvider>().loadTransactions();
    });
  }

  void _handleTabChange() {
    if (_tabController.indexIsChanging) return;

    final provider = context.read<TransactionProvider>();
    switch (_tabController.index) {
      case 0:
        provider.setTypeFilter(null);
        break;
      case 1:
        provider.setTypeFilter('Inflow');
        break;
      case 2:
        provider.setTypeFilter('Outflow');
        break;
    }
  }

  @override
  void dispose() {
    _tabController.dispose();
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Transactions'),
        bottom: TabBar(
          controller: _tabController,
          indicatorColor: AppColors.brand,
          labelColor: Colors.white,
          unselectedLabelColor: Colors.white70,
          indicatorWeight: 3,
          tabs: const [
            Tab(text: 'All'),
            Tab(text: 'Inflow'),
            Tab(text: 'Outflow'),
          ],
        ),
      ),
      drawer: const AppDrawer(),
      body: Column(
        children: [
          // Search Bar
          Padding(
            padding: const EdgeInsets.all(16.0),
            child: TextField(
              controller: _searchController,
              onChanged: (value) =>
                  context.read<TransactionProvider>().setSearchQuery(value),
              decoration: InputDecoration(
                hintText: 'Search description...',
                prefixIcon: const Icon(Icons.search),
                filled: true,
                fillColor: Colors.white,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                  borderSide: BorderSide.none,
                ),
                contentPadding: const EdgeInsets.symmetric(horizontal: 16),
              ),
            ),
          ),

          // Transaction List
          Expanded(
            child: Consumer<TransactionProvider>(
              builder: (context, provider, child) {
                if (provider.isLoading && provider.transactions.isEmpty) {
                  return const Center(child: CircularProgressIndicator());
                }

                if (provider.error != null && provider.transactions.isEmpty) {
                  return Center(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        const Icon(Icons.error_outline,
                            size: 48, color: AppColors.error),
                        const SizedBox(height: 16),
                        Text(provider.error!),
                        const SizedBox(height: 16),
                        ElevatedButton(
                          onPressed: () => provider.loadTransactions(),
                          child: const Text('Retry'),
                        ),
                      ],
                    ),
                  );
                }

                if (provider.transactions.isEmpty) {
                  return const Center(child: Text('No transactions found'));
                }

                return RefreshIndicator(
                  onRefresh: () => provider.loadTransactions(),
                  child: ListView.separated(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                    itemCount: provider.transactions.length,
                    separatorBuilder: (context, index) =>
                        const SizedBox(height: 8),
                    itemBuilder: (context, index) {
                      final transaction = provider.transactions[index];
                      return TransactionCard(transaction: transaction);
                    },
                  ),
                );
              },
            ),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () => Navigator.pushNamed(context, AppRoutes.addTransaction),
        backgroundColor: AppColors.brand,
        child: const Icon(Icons.add, color: AppColors.dark),
      ),
    );
  }
}
