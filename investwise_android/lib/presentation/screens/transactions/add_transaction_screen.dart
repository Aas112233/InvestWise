import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:intl/intl.dart';
import 'package:investwise_android/core/constants/app_colors.dart';
import 'package:investwise_android/presentation/providers/transaction_provider.dart';
import 'package:investwise_android/presentation/providers/fund_provider.dart';
import 'package:investwise_android/presentation/providers/member_provider.dart';
import 'package:investwise_android/presentation/providers/project_provider.dart';

class AddTransactionScreen extends StatefulWidget {
  const AddTransactionScreen({super.key});

  @override
  State<AddTransactionScreen> createState() => _AddTransactionScreenState();
}

class _AddTransactionScreenState extends State<AddTransactionScreen> {
  final _formKey = GlobalKey<FormState>();

  // State
  String _transactionType = 'Deposit'; // 'Deposit' or 'Expense'
  final _amountController = TextEditingController();
  final _descriptionController = TextEditingController();
  final _categoryController = TextEditingController();

  DateTime _date = DateTime.now();
  String? _selectedFundId;
  String? _selectedMemberId;
  String? _selectedProjectId;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  void _loadData() {
    Future.microtask(() {
      if (mounted) {
        context.read<FundProvider>().loadFunds();
        context.read<MemberProvider>().loadMembers();
        context.read<ProjectProvider>().loadProjects();
      }
    });
  }

  @override
  void dispose() {
    _amountController.dispose();
    _descriptionController.dispose();
    _categoryController.dispose();
    super.dispose();
  }

  Future<void> _selectDate(BuildContext context) async {
    final DateTime? picked = await showDatePicker(
      context: context,
      initialDate: _date,
      firstDate: DateTime(2020),
      lastDate: DateTime.now(),
      builder: (context, child) {
        return Theme(
          data: Theme.of(context).copyWith(
            colorScheme: const ColorScheme.light(
              primary: AppColors.brand,
              onPrimary: AppColors.dark,
              onSurface: AppColors.dark,
            ),
          ),
          child: child!,
        );
      },
    );
    if (picked != null) {
      setState(() => _date = picked);
    }
  }

  void _submit() async {
    if (!_formKey.currentState!.validate()) return;
    if (_selectedFundId == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please select a fund')),
      );
      return;
    }

    final Map<String, dynamic> data = {
      'amount': double.tryParse(_amountController.text) ?? 0,
      'description': _descriptionController.text,
      'category': _categoryController.text,
      'date': _date.toIso8601String(),
      'fundId': _selectedFundId,
    };

    bool success = false;
    if (_transactionType == 'Deposit') {
      data['memberId'] = _selectedMemberId;
      success = await context.read<TransactionProvider>().addDeposit(data);
    } else {
      data['projectId'] = _selectedProjectId;
      success = await context.read<TransactionProvider>().addExpense(data);
    }

    if (success && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('$_transactionType added successfully')),
      );
      Navigator.pop(context);
    } else if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
            content: Text(context.read<TransactionProvider>().error ??
                'Operation failed')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Add Transaction'),
        elevation: 0,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16.0),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Type Selector
              _buildTypeSelector(),
              const SizedBox(height: 24),

              _buildSectionTitle('Transaction Details'),
              _buildTextField(_amountController, 'Amount', Icons.attach_money,
                  keyboardType: TextInputType.number,
                  validator: (v) => v!.isEmpty ? 'Required' : null),
              const SizedBox(height: 12),
              _buildTextField(
                  _descriptionController, 'Description', Icons.description),
              const SizedBox(height: 12),
              _buildTextField(_categoryController, 'Category', Icons.category),

              const SizedBox(height: 24),
              _buildSectionTitle('Source/Destination'),
              _buildFundDropdown(),

              if (_transactionType == 'Deposit') ...[
                const SizedBox(height: 12),
                _buildMemberDropdown(),
              ] else ...[
                const SizedBox(height: 12),
                _buildProjectDropdown(),
              ],

              const SizedBox(height: 24),
              _buildSectionTitle('Schedule'),
              _buildDatePicker(),

              const SizedBox(height: 32),
              _buildSubmitButton(),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildTypeSelector() {
    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: AppColors.primary.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          Expanded(
            child: _TypeButton(
              label: 'Deposit',
              isSelected: _transactionType == 'Deposit',
              onTap: () => setState(() => _transactionType = 'Deposit'),
              activeColor: AppColors.success,
            ),
          ),
          Expanded(
            child: _TypeButton(
              label: 'Expense',
              isSelected: _transactionType == 'Expense',
              onTap: () => setState(() => _transactionType = 'Expense'),
              activeColor: AppColors.error,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSectionTitle(String title) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12.0),
      child: Text(
        title.toUpperCase(),
        style: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.bold,
          color: AppColors.primary.withValues(alpha: 0.6),
          letterSpacing: 1.2,
        ),
      ),
    );
  }

  Widget _buildTextField(
    TextEditingController controller,
    String label,
    IconData icon, {
    TextInputType keyboardType = TextInputType.text,
    String? Function(String?)? validator,
  }) {
    return TextFormField(
      controller: controller,
      keyboardType: keyboardType,
      validator: validator,
      decoration: InputDecoration(
        labelText: label,
        prefixIcon: Icon(icon, color: AppColors.primary),
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide:
              BorderSide(color: AppColors.primary.withValues(alpha: 0.1)),
        ),
      ),
    );
  }

  Widget _buildFundDropdown() {
    return Consumer<FundProvider>(
      builder: (context, provider, _) {
        return DropdownButtonFormField<String>(
          initialValue: _selectedFundId,
          decoration: _dropdownDecoration('Select Fund', Icons.account_balance),
          items: provider.funds
              .map((f) => DropdownMenuItem(
                    value: f.id,
                    child:
                        Text('${f.name} (BDT ${f.balance.toStringAsFixed(0)})'),
                  ))
              .toList(),
          onChanged: (id) => setState(() => _selectedFundId = id),
          validator: (v) => v == null ? 'Required' : null,
        );
      },
    );
  }

  Widget _buildMemberDropdown() {
    return Consumer<MemberProvider>(
      builder: (context, provider, _) {
        return DropdownButtonFormField<String>(
          initialValue: _selectedMemberId,
          decoration: _dropdownDecoration('Select Member', Icons.person),
          items: provider.members
              .map((m) => DropdownMenuItem(
                    value: m.id,
                    child: Text(m.name),
                  ))
              .toList(),
          onChanged: (id) => setState(() => _selectedMemberId = id),
        );
      },
    );
  }

  Widget _buildProjectDropdown() {
    return Consumer<ProjectProvider>(
      builder: (context, provider, _) {
        return DropdownButtonFormField<String>(
          initialValue: _selectedProjectId,
          decoration: _dropdownDecoration('Select Project', Icons.work),
          items: provider.projects
              .map((p) => DropdownMenuItem(
                    value: p.id,
                    child: Text(p.title),
                  ))
              .toList(),
          onChanged: (id) => setState(() => _selectedProjectId = id),
        );
      },
    );
  }

  InputDecoration _dropdownDecoration(String label, IconData icon) {
    return InputDecoration(
      labelText: label,
      prefixIcon: Icon(icon, color: AppColors.primary),
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: AppColors.primary.withValues(alpha: 0.1)),
      ),
    );
  }

  Widget _buildDatePicker() {
    return InkWell(
      onTap: () => _selectDate(context),
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 16),
        decoration: BoxDecoration(
          border: Border.all(color: AppColors.primary.withValues(alpha: 0.1)),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Row(
          children: [
            const Icon(Icons.calendar_today,
                size: 20, color: AppColors.primary),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Date',
                      style: TextStyle(fontSize: 12, color: Colors.grey)),
                  Text(DateFormat('MMM dd, yyyy').format(_date),
                      style: const TextStyle(fontWeight: FontWeight.w500)),
                ],
              ),
            ),
            const Icon(Icons.chevron_right, color: Colors.grey),
          ],
        ),
      ),
    );
  }

  Widget _buildSubmitButton() {
    return SizedBox(
      width: double.infinity,
      child: Consumer<TransactionProvider>(
        builder: (context, provider, _) {
          return ElevatedButton(
            onPressed: provider.isLoading ? null : _submit,
            style: ElevatedButton.styleFrom(
              backgroundColor: _transactionType == 'Deposit'
                  ? AppColors.success
                  : AppColors.error,
              foregroundColor: Colors.white,
              padding: const EdgeInsets.symmetric(vertical: 16),
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12)),
            ),
            child: provider.isLoading
                ? const CircularProgressIndicator(color: Colors.white)
                : Text('ADD $_transactionType'.toUpperCase(),
                    style: const TextStyle(
                        fontWeight: FontWeight.bold, fontSize: 16)),
          );
        },
      ),
    );
  }
}

class _TypeButton extends StatelessWidget {
  final String label;
  final bool isSelected;
  final VoidCallback onTap;
  final Color activeColor;

  const _TypeButton({
    required this.label,
    required this.isSelected,
    required this.onTap,
    required this.activeColor,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 12),
        decoration: BoxDecoration(
          color: isSelected ? activeColor : Colors.transparent,
          borderRadius: BorderRadius.circular(8),
        ),
        child: Text(
          label,
          textAlign: TextAlign.center,
          style: TextStyle(
            color: isSelected
                ? Colors.white
                : AppColors.primary.withValues(alpha: 0.6),
            fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
          ),
        ),
      ),
    );
  }
}
