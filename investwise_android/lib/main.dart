import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'core/network/dio_client.dart';
import 'core/constants/app_colors.dart';
import 'core/constants/app_routes.dart';
import 'data/datasources/remote/auth_api.dart';
import 'data/datasources/remote/analytics_api.dart';
import 'data/datasources/remote/member_api.dart';
import 'data/datasources/remote/project_api.dart';
import 'data/datasources/remote/finance_api.dart';
import 'data/datasources/remote/fund_api.dart';
import 'presentation/providers/auth_provider.dart';
import 'presentation/providers/dashboard_provider.dart';
import 'presentation/providers/member_provider.dart';
import 'presentation/providers/project_provider.dart';
import 'presentation/providers/transaction_provider.dart';
import 'presentation/providers/fund_provider.dart';
import 'presentation/screens/auth/login_screen.dart';
import 'presentation/screens/dashboard/dashboard_screen.dart';
import 'presentation/screens/members/member_list_screen.dart';
import 'presentation/screens/projects/project_list_screen.dart';
import 'presentation/screens/projects/project_detail_screen.dart';
import 'presentation/screens/projects/add_project_screen.dart';
import 'presentation/screens/transactions/transaction_list_screen.dart';
import 'presentation/screens/transactions/add_transaction_screen.dart';
import 'presentation/screens/deposits/deposits_screen.dart';
import 'presentation/screens/deposits/request_deposit_screen.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

void main() {
  runApp(const InvestWiseApp());
}

class InvestWiseApp extends StatelessWidget {
  const InvestWiseApp({super.key});

  @override
  Widget build(BuildContext context) {
    // Dependency Injection
    const storage = FlutterSecureStorage();
    final dioClient = DioClient(storage);
    final authApi = AuthApi(dioClient.dio);
    final analyticsApi = AnalyticsApi(dioClient.dio);
    final memberApi = MemberApi(dioClient.dio);
    final projectApi = ProjectApi(dioClient.dio);
    final financeApi = FinanceApi(dioClient.dio);
    final fundApi = FundApi(dioClient.dio);

    return MultiProvider(
      providers: [
        ChangeNotifierProvider(
          create: (_) => AuthProvider(
            authApi: authApi,
            dioClient: dioClient,
          ),
        ),
        ChangeNotifierProvider(
          create: (_) => DashboardProvider(
            analyticsApi: analyticsApi,
          ),
        ),
        ChangeNotifierProvider(
          create: (_) => MemberProvider(
            memberApi: memberApi,
          ),
        ),
        ChangeNotifierProvider(
          create: (_) => ProjectProvider(
            projectApi: projectApi,
          ),
        ),
        ChangeNotifierProvider(
          create: (_) => TransactionProvider(
            financeApi: financeApi,
          ),
        ),
        ChangeNotifierProvider(
          create: (_) => FundProvider(
            fundApi: fundApi,
          ),
        ),
      ],
      child: MaterialApp(
        title: 'InvestWise',
        debugShowCheckedModeBanner: false,
        theme: ThemeData(
          primaryColor: AppColors.primary,
          scaffoldBackgroundColor: AppColors.grey50,
          colorScheme: ColorScheme.fromSeed(
            seedColor: AppColors.brand,
            primary: AppColors.primary,
            secondary: AppColors.accent,
          ),
          appBarTheme: const AppBarTheme(
            backgroundColor: AppColors.primary,
            foregroundColor: AppColors.white,
            elevation: 0,
          ),
          elevatedButtonTheme: ElevatedButtonThemeData(
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.brand,
              foregroundColor: AppColors.dark,
            ),
          ),
          useMaterial3: true,
        ),
        initialRoute: AppRoutes.login,
        routes: {
          AppRoutes.login: (context) => const LoginScreen(),
          AppRoutes.dashboard: (context) => const DashboardScreen(),
          AppRoutes.members: (context) => const MemberListScreen(),
          AppRoutes.projects: (context) => const ProjectListScreen(),
          AppRoutes.projectDetail: (context) => const ProjectDetailScreen(),
          AppRoutes.addProject: (context) => const AddProjectScreen(),
          AppRoutes.transactions: (context) => const TransactionListScreen(),
          AppRoutes.addTransaction: (context) => const AddTransactionScreen(),
          AppRoutes.deposits: (context) => const DepositsScreen(),
          AppRoutes.requestDeposit: (context) => const RequestDepositScreen(),
        },
      ),
    );
  }
}
