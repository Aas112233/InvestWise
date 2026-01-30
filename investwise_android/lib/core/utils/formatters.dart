import 'package:intl/intl.dart';

class AppFormatters {
  // Currency Formatter
  static String formatCurrency(num amount, {String currency = 'BDT'}) {
    final formatter = NumberFormat('#,##0.00', 'en_US');
    return '$currency ${formatter.format(amount)}';
  }

  // Compact Number Formatter (k, M, B)
  static String formatCompactNumber(num number) {
    if (number >= 1000000000) {
      return '${(number / 1000000000).toStringAsFixed(1)}B';
    } else if (number >= 1000000) {
      return '${(number / 1000000).toStringAsFixed(1)}M';
    } else if (number >= 1000) {
      return '${(number / 1000).toStringAsFixed(1)}k';
    } else {
      return number.toStringAsFixed(0);
    }
  }

  // Date Formatter
  static String formatDate(DateTime date) {
    return DateFormat('MMM dd, yyyy').format(date);
  }

  // Date Time Formatter
  static String formatDateTime(DateTime dateTime) {
    return DateFormat('MMM dd, yyyy hh:mm a').format(dateTime);
  }

  // Month Year Formatter
  static String formatMonthYear(DateTime date) {
    return DateFormat('MMMM yyyy').format(date);
  }
}
