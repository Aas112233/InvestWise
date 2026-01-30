import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:intl/intl.dart';
import 'package:investwise_android/core/constants/app_colors.dart';
import 'package:investwise_android/presentation/providers/project_provider.dart';
import 'package:investwise_android/presentation/providers/member_provider.dart';

class AddProjectScreen extends StatefulWidget {
  const AddProjectScreen({super.key});

  @override
  State<AddProjectScreen> createState() => _AddProjectScreenState();
}

class _AddProjectScreenState extends State<AddProjectScreen> {
  final _formKey = GlobalKey<FormState>();

  // Form Controllers
  final _titleController = TextEditingController();
  final _categoryController = TextEditingController();
  final _descriptionController = TextEditingController();
  final _initialInvestmentController = TextEditingController(text: '0');
  final _budgetController = TextEditingController(text: '0');
  final _roiController = TextEditingController(text: '0');
  final _sharesController = TextEditingController(text: '0');

  DateTime? _startDate;
  DateTime? _completionDate;
  String? _selectedFundHandler;
  final List<Map<String, dynamic>> _involvedMembers = [];

  @override
  void initState() {
    super.initState();
    // Load members for selection
    Future.microtask(() {
      if (mounted) {
        context.read<MemberProvider>().loadMembers();
      }
    });
  }

  @override
  void dispose() {
    _titleController.dispose();
    _categoryController.dispose();
    _descriptionController.dispose();
    _initialInvestmentController.dispose();
    _budgetController.dispose();
    _roiController.dispose();
    _sharesController.dispose();
    super.dispose();
  }

  Future<void> _selectDate(BuildContext context, bool isStart) async {
    final DateTime? picked = await showDatePicker(
      context: context,
      initialDate: DateTime.now(),
      firstDate: DateTime(2020),
      lastDate: DateTime(2030),
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
      setState(() {
        if (isStart) {
          _startDate = picked;
        } else {
          _completionDate = picked;
        }
      });
    }
  }

  void _submit() async {
    if (!_formKey.currentState!.validate()) return;

    final projectData = {
      'title': _titleController.text,
      'category': _categoryController.text,
      'description': _descriptionController.text,
      'initialInvestment':
          double.tryParse(_initialInvestmentController.text) ?? 0,
      'budget': double.tryParse(_budgetController.text) ?? 0,
      'expectedRoi': double.tryParse(_roiController.text) ?? 0,
      'totalShares': int.tryParse(_sharesController.text) ?? 0,
      'startDate': _startDate?.toIso8601String(),
      'completionDate': _completionDate?.toIso8601String(),
      'projectFundHandler': _selectedFundHandler,
      'involvedMembers': _involvedMembers,
    };

    final success =
        await context.read<ProjectProvider>().createProject(projectData);

    if (success && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Project created successfully')),
      );
      Navigator.pop(context);
    } else if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
            content: Text(context.read<ProjectProvider>().error ??
                'Failed to create project')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Add New Project'),
        actions: [
          IconButton(
            onPressed: _submit,
            icon: const Icon(Icons.check),
          ),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16.0),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _buildSectionTitle('Project Details'),
              _buildTextField(_titleController, 'Project Title', Icons.title,
                  validator: (v) => v!.isEmpty ? 'Required' : null),
              const SizedBox(height: 12),
              _buildTextField(_categoryController, 'Category', Icons.category),
              const SizedBox(height: 12),
              _buildTextField(
                  _descriptionController, 'Description', Icons.description,
                  maxLines: 3),
              const SizedBox(height: 24),
              _buildSectionTitle('Financial Setup'),
              Row(
                children: [
                  Expanded(
                      child: _buildTextField(_budgetController, 'Budget',
                          Icons.account_balance_wallet,
                          keyboardType: TextInputType.number)),
                  const SizedBox(width: 12),
                  Expanded(
                      child: _buildTextField(_initialInvestmentController,
                          'Initial Investment', Icons.monetization_on,
                          keyboardType: TextInputType.number)),
                ],
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                      child: _buildTextField(
                          _roiController, 'Expected ROI (%)', Icons.trending_up,
                          keyboardType: TextInputType.number)),
                  const SizedBox(width: 12),
                  Expanded(
                      child: _buildTextField(
                          _sharesController, 'Total Shares', Icons.pie_chart,
                          keyboardType: TextInputType.number)),
                ],
              ),
              const SizedBox(height: 24),
              _buildSectionTitle('Schedule'),
              Row(
                children: [
                  Expanded(
                    child: _buildDatePicker(
                      'Start Date',
                      _startDate,
                      () => _selectDate(context, true),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: _buildDatePicker(
                      'Completion Date',
                      _completionDate,
                      () => _selectDate(context, false),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 32),
              SizedBox(
                width: double.infinity,
                child: Consumer<ProjectProvider>(
                  builder: (context, provider, _) {
                    return ElevatedButton(
                      onPressed: provider.isLoading ? null : _submit,
                      style: ElevatedButton.styleFrom(
                        padding: const EdgeInsets.symmetric(vertical: 16),
                        shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(12)),
                      ),
                      child: provider.isLoading
                          ? const CircularProgressIndicator()
                          : const Text('CREATE PROJECT',
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
    int maxLines = 1,
    TextInputType keyboardType = TextInputType.text,
    String? Function(String?)? validator,
  }) {
    return TextFormField(
      controller: controller,
      maxLines: maxLines,
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

  Widget _buildDatePicker(String label, DateTime? date, VoidCallback onTap) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 16),
        decoration: BoxDecoration(
          border: Border.all(color: AppColors.primary.withValues(alpha: 0.1)),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(label,
                style: const TextStyle(fontSize: 12, color: Colors.grey)),
            const SizedBox(height: 4),
            Row(
              children: [
                const Icon(Icons.calendar_today,
                    size: 16, color: AppColors.primary),
                const SizedBox(width: 8),
                Text(
                  date != null
                      ? DateFormat('MMM dd, yyyy').format(date)
                      : 'Select',
                  style: const TextStyle(fontWeight: FontWeight.w500),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
