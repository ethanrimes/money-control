// Plain Dart models for every row the app reads from Supabase.
//
// Why hand-rolled (no freezed / json_serializable): keeps the build pipeline
// codegen-free, which means CI doesn't need a build_runner step. The trade-off
// is a bit of fromJson boilerplate.

enum AccountType { depository, credit }

enum CategoryType { expense, income, transfer }

enum TransactionSource { excel, teller, plaid, manual }

AccountType _accountType(String? s) {
  switch (s) {
    case 'credit':
      return AccountType.credit;
    default:
      return AccountType.depository;
  }
}

CategoryType _categoryType(String? s) {
  switch (s) {
    case 'income':
      return CategoryType.income;
    case 'transfer':
      return CategoryType.transfer;
    default:
      return CategoryType.expense;
  }
}

TransactionSource _txnSource(String? s) {
  switch (s) {
    case 'teller':
      return TransactionSource.teller;
    case 'plaid':
      return TransactionSource.plaid;
    case 'manual':
      return TransactionSource.manual;
    default:
      return TransactionSource.excel;
  }
}

int _asInt(dynamic v) {
  if (v is int) return v;
  if (v is num) return v.toInt();
  if (v is String) return int.parse(v);
  throw FormatException('not int: $v');
}

double _asDouble(dynamic v) {
  if (v is double) return v;
  if (v is num) return v.toDouble();
  if (v is String) return double.parse(v);
  throw FormatException('not double: $v');
}

String? _asNullableString(dynamic v) {
  if (v == null) return null;
  return v.toString();
}

int? _asNullableInt(dynamic v) {
  if (v == null) return null;
  if (v is int) return v;
  if (v is num) return v.toInt();
  if (v is String && v.isNotEmpty) return int.parse(v);
  return null;
}

double? _asNullableDouble(dynamic v) {
  if (v == null) return null;
  if (v is double) return v;
  if (v is num) return v.toDouble();
  if (v is String && v.isNotEmpty) return double.parse(v);
  return null;
}

class Account {
  Account({
    required this.id,
    required this.name,
    required this.type,
    required this.institution,
    required this.lastFour,
    required this.subtype,
    required this.tellerEnrollmentId,
    required this.plaidItemId,
    this.latestBalance,
    this.latestBalanceDate,
  });

  final int id;
  final String name;
  final AccountType type;
  final String? institution;
  final String? lastFour;
  final String? subtype;
  final int? tellerEnrollmentId;
  final int? plaidItemId;
  final double? latestBalance;
  final String? latestBalanceDate;

  bool get isOrphan => tellerEnrollmentId == null && plaidItemId == null;
  bool get isSeeded => isOrphan && (subtype == null || subtype!.isEmpty);
  bool get isManual => isOrphan && !isSeeded;
  double get signedBalance {
    final b = latestBalance ?? 0;
    if (b == 0) return 0;
    return type == AccountType.credit ? -b : b;
  }

  factory Account.fromJson(Map<String, dynamic> j) {
    // The "latest balance" join comes through as a list of {current, as_of_date}
    // rows; we requested order=as_of_date.desc + limit=1 so the first entry
    // is what we want.
    double? bal;
    String? balDate;
    final balRows = j['balances'];
    if (balRows is List && balRows.isNotEmpty) {
      final first = balRows.first as Map<String, dynamic>;
      bal = _asNullableDouble(first['current']);
      balDate = _asNullableString(first['as_of_date']);
    }
    return Account(
      id: _asInt(j['id']),
      name: (j['name'] as String?) ?? '',
      type: _accountType(j['type'] as String?),
      institution: _asNullableString(j['institution']),
      lastFour: _asNullableString(j['last_four']),
      subtype: _asNullableString(j['subtype']),
      tellerEnrollmentId: _asNullableInt(j['teller_enrollment_id']),
      plaidItemId: _asNullableInt(j['plaid_item_id']),
      latestBalance: bal,
      latestBalanceDate: balDate,
    );
  }
}

class AppCategory {
  AppCategory({
    required this.id,
    required this.name,
    required this.parentId,
    required this.type,
    required this.color,
  });

  final int id;
  final String name;
  final int? parentId;
  final CategoryType type;
  final String? color;

  factory AppCategory.fromJson(Map<String, dynamic> j) {
    return AppCategory(
      id: _asInt(j['id']),
      name: (j['name'] as String?) ?? '',
      parentId: _asNullableInt(j['parent_id']),
      type: _categoryType(j['type'] as String?),
      color: _asNullableString(j['color']),
    );
  }
}

/// Tree shape: each top-level category + its subcategories grouped.
class CategoryNode {
  CategoryNode({required this.category, required this.subcategories});

  final AppCategory category;
  final List<AppCategory> subcategories;
}

class AppTransaction {
  AppTransaction({
    required this.id,
    required this.date,
    required this.description,
    required this.amount,
    required this.accountId,
    required this.accountName,
    required this.categoryId,
    required this.categoryName,
    required this.categoryType,
    required this.subcategoryId,
    required this.subcategoryName,
    required this.source,
    required this.notes,
  });

  final int id;
  final String date; // YYYY-MM-DD
  final String description;
  final double amount;
  final int accountId;
  final String? accountName;
  final int? categoryId;
  final String? categoryName;
  final CategoryType? categoryType;
  final int? subcategoryId;
  final String? subcategoryName;
  final TransactionSource source;
  final String? notes;

  String get monthKey => date.length >= 7 ? date.substring(0, 7) : date;
  int get day => date.length >= 10 ? int.parse(date.substring(8, 10)) : 1;

  factory AppTransaction.fromJson(Map<String, dynamic> j) {
    final acct = j['accounts'] as Map<String, dynamic>?;
    final cat = j['category'] as Map<String, dynamic>?;
    final sub = j['subcategory'] as Map<String, dynamic>?;
    return AppTransaction(
      id: _asInt(j['id']),
      date: (j['date'] as String?) ?? '',
      description: (j['description'] as String?) ?? '',
      amount: _asDouble(j['amount']),
      accountId: _asInt(j['account_id']),
      accountName: _asNullableString(acct?['name']),
      categoryId: _asNullableInt(j['category_id']),
      categoryName: _asNullableString(cat?['name']),
      categoryType:
          cat == null ? null : _categoryType(cat['type'] as String?),
      subcategoryId: _asNullableInt(j['subcategory_id']),
      subcategoryName: _asNullableString(sub?['name']),
      source: _txnSource(j['source'] as String?),
      notes: _asNullableString(j['notes']),
    );
  }
}

class BudgetSettings {
  BudgetSettings({
    required this.id,
    required this.monthlySavingsTarget,
    required this.effectiveFrom,
  });

  final int id;
  final double monthlySavingsTarget;
  final String effectiveFrom;

  factory BudgetSettings.fromJson(Map<String, dynamic> j) {
    return BudgetSettings(
      id: _asInt(j['id']),
      monthlySavingsTarget: _asDouble(j['monthly_savings_target']),
      effectiveFrom: (j['effective_from'] as String?) ?? '',
    );
  }
}
