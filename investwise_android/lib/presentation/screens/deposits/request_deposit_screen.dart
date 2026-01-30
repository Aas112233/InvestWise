import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:intl/intl.dart';
import 'package:investwise_android/core/constants/app_colors.dart';
import 'package:investwise_android/presentation/providers/transaction_provider.dart';
import 'package:investwise_android/presentation/providers/fund_provider.dart';
import 'package:investwise_android/presentation/providers/member_provider.dart';
import 'package:investwise_android/presentation/providers/auth_provider.dart';

class RequestDepositScreen extends StatefulWidget {
  const RequestDepositScreen({super.key});

  @override
  State<RequestDepositScreen> createState() => _RequestDepositScreenState();
}

class _RequestDepositScreenState extends State<RequestDepositScreen> {
  final _formKey = GlobalKey<FormState>();

  final _amountController = TextEditingController();
  final _descriptionController = TextEditingController();
  final _referenceController = TextEditingController(); // For proof of payment reference

  DateTime _date = DateTime.now();
  String? _selectedFundId;
  String _selectedMethod = 'Bank Transfer';
  
  // List of deposit methods
  final List<String> _depositMethods = [
    'Bank Transfer',
    'Cash',
    'Mobile Money',
    'Check',
    'Other'
  ];

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  void _loadData() {
    Future.microtask(() {
      if (mounted) {
        context.read<FundProvider>().loadFunds();
        // We need member ID, likely from AuthProvider or MemberProvider
        // Assuming current user is the member making the request
      }
    });
  }

  @override
  void dispose() {
    _amountController.dispose();
    _descriptionController.dispose();
    _referenceController.dispose();
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
        const SnackBar(content: Text('Please select a target fund')),
      );
      return;
    }

    final authProvider = context.read<AuthProvider>();
    final currentUser = authProvider.currentUser;

    if (currentUser == null) {
       ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('User not authenticated')),
      );
      return;
    }

    // Prepare data
    final Map<String, dynamic> data = {
      'amount': double.tryParse(_amountController.text) ?? 0,
      'description': _descriptionController.text.isEmpty 
          ? 'Deposit Request via App' 
          : _descriptionController.text,
      'category': 'Deposit', // Default category
      'date': _date.toIso8601String(),
      'fundId': _selectedFundId,
      'memberId': currentUser.id, // Assuming user ID matches member ID or is linked
      'status': 'Pending', // Explicitly setting status to Pending
      'depositMethod': _selectedMethod,
      'type': 'Deposit', // Required by backend validation usually
    };

    // Add reference if provided
    if (_referenceController.text.isNotEmpty) {
      data['reference'] = _referenceController.text;
       // If backend supports storing reference in description or separate field
       // appending to description for now if no dedicated field is expected by standard API
       data['description'] = '${data['description']} (Ref: ${_referenceController.text})';
    }

    final success = await context.read<TransactionProvider>().addDeposit(data);

    if (success && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Deposit request submitted successfully'),
          backgroundColor: AppColors.success,
        ),
      );
      Navigator.pop(context);
    } else if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
            content: Text(context.read<TransactionProvider>().error ??
                'Request failed'),
            backgroundColor: AppColors.error),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Request Deposit'),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16.0),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _buildSectionTitle('Deposit Amount'),
              _buildTextField(
                _amountController, 
                'Amount (BDT)', 
                Icons.attach_money,
                keyboardType: TextInputType.number,
                validator: (v) {
                  if (v == null || v.isEmpty) return 'Required';
                  if (double.tryParse(v) == null) return 'Invalid number';
                  return null;
                }
              ),
              
              const SizedBox(height: 24),
              _buildSectionTitle('Target Fund'),
              _buildFundDropdown(),

              const SizedBox(height: 24),
              _buildSectionTitle('Payment Details'),
              _buildMethodDropdown(),
              const SizedBox(height: 12),
              _buildTextField(
                _referenceController, 
                'Reference / Transaction ID', 
                Icons.receipt_long
              ),
              const SizedBox(height: 12),
               _buildTextField(
                _descriptionController, 
                'Note (Optional)', 
                Icons.description,
                maxLines: 2
              ),

              const SizedBox(height: 24),
              _buildSectionTitle('Date of Transfer'),
              _buildDatePicker(),

              const SizedBox(height: 40),
              SizedBox(
                width: double.infinity,
                child: Consumer<TransactionProvider>(
                  builder: (context, provider, _) {
                    return ElevatedButton(
                      onPressed: provider.isLoading ? null : _submit,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppColors.brand,
                        foregroundColor: AppColors.dark,
                        padding: const EdgeInsets.symmetric(vertical: 16),
                        shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(12)),
                      ),
                      child: provider.isLoading
                          ? const CircularProgressIndicator(color: AppColors.dark)
                          : const Text('SUBMIT REQUEST',
                              style: TextStyle(
                                  fontWeight: FontWeight.bold, fontSize: 16)),
                    );
                  },
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildSectionTitle(String title) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8.0),
      child: Text(
        title.toUpperCase(),
        style: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.bold,
          color: AppColors.grey600,
          letterSpacing: 1.0,
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
    int maxLines = 1,
  }) {
    return TextFormField(
      controller: controller,
      keyboardType: keyboardType,
      validator: validator,
      maxLines: maxLines,
      decoration: InputDecoration(
        labelText: label,
        prefixIcon: Icon(icon, color: AppColors.primary),
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
        filled: true,
        fillColor: Colors.white,
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: AppColors.grey300),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: AppColors.brand, width: 2),
        ),
      ),
    );
  }

  Widget _buildFundDropdown() {
    return Consumer<FundProvider>(
      builder: (context, provider, _) {
        if (provider.funds.isEmpty && provider.isLoading) {
           return const LinearProgressIndicator();
        }
        
        return DropdownButtonFormField<String>(
          initialValue: _selectedFundId,
          decoration: InputDecoration(
            labelText: 'Select Fund',
            prefixIcon: const Icon(Icons.account_balance, color: AppColors.primary),
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
            filled: true,
            fillColor: Colors.white,
          ),
          items: provider.funds
              .map((f) => DropdownMenuItem(
                    value: f.id,
                    child: Text('${f.name} (BDT ${f.balance.toStringAsFixed(0)})'),
                  ))
              .toList(),
          onChanged: (id) => setState(() => _selectedFundId = id),
          validator: (v) => v == null ? 'Required' : null,
        );
      },
    );
  }

  Widget _buildMethodDropdown() {
    return DropdownButtonFormField<String>(
      value: _selectedMethod,
      decoration: InputDecoration(
        labelText: 'Payment Method',
        prefixIcon: const Icon(Icons.payment, color: AppColors.primary),
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
        filled: true,
        fillColor: Colors.white,
      ),
      items: _depositMethods
          .map((m) => DropdownMenuItem(
                value: m,
                child: Text(m),
              ))
          .toList(),
      onChanged: (val) {
        if (val != null) setState(() => _selectedMethod = val);
      },
    );
  }

  Widget _buildDatePicker() {
    return InkWell(
      onTap: () => _selectDate(context),
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 16),
        decoration: BoxDecoration(
          border: Border.all(color: AppColors.grey300),
          borderRadius: BorderRadius.circular(12),
          color: Colors.white,
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
                   Text(DateFormat('MMM dd, yyyy').format(_date),
                      style: const TextStyle(fontWeight: FontWeight.w500, fontSize: 16)),
                ],
              ),
            ),
            const Icon(Icons.chevron_right, color: Colors.grey),
          ],
        ),
      ),
    );
  }
}
