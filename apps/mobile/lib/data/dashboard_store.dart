import 'package:flutter/foundation.dart';

import 'models.dart';
import 'repos.dart';

/// Single source of truth for everything every page needs. Pages call
/// [refresh] once on `initState`; mutations call [refresh] again so the
/// derived analytics recompute. Pure in-memory — no caching to disk yet.
class DashboardStore extends ChangeNotifier {
  DashboardStore(this.repo);

  final MoneyControlRepo repo;

  bool _loading = false;
  bool get loading => _loading;
  Object? _error;
  Object? get error => _error;

  List<Account> _accounts = const <Account>[];
  List<Account> get accounts => _accounts;

  List<AppCategory> _categories = const <AppCategory>[];
  List<AppCategory> get categories => _categories;
  List<CategoryNode> _categoryTree = const <CategoryNode>[];
  List<CategoryNode> get categoryTree => _categoryTree;

  List<AppTransaction> _transactions = const <AppTransaction>[];
  List<AppTransaction> get transactions => _transactions;

  BudgetSettings? _budget;
  BudgetSettings? get budget => _budget;
  double get monthlySavingsTarget => _budget?.monthlySavingsTarget ?? 0;

  DateTime _lastLoadedAt = DateTime.fromMillisecondsSinceEpoch(0);
  DateTime get lastLoadedAt => _lastLoadedAt;

  Future<void> refresh() async {
    _loading = true;
    _error = null;
    notifyListeners();
    try {
      final results = await Future.wait([
        repo.listAccounts(),
        repo.listCategories(),
        repo.listTransactions(),
        repo.latestBudget(),
      ]);
      _accounts = results[0] as List<Account>;
      _categories = results[1] as List<AppCategory>;
      _transactions = results[2] as List<AppTransaction>;
      _budget = results[3] as BudgetSettings?;
      _categoryTree = repo.buildCategoryTree(_categories);
      _lastLoadedAt = DateTime.now();
    } catch (e) {
      _error = e;
    } finally {
      _loading = false;
      notifyListeners();
    }
  }

  /// Optimistically replace a transaction's category in memory so the UI
  /// doesn't wait for a round-trip. Caller is responsible for the actual
  /// patch + refresh.
  void patchTransactionLocal(int id,
      {int? categoryId, int? subcategoryId}) {
    final idx = _transactions.indexWhere((t) => t.id == id);
    if (idx < 0) return;
    final t = _transactions[idx];
    final cat = categoryId == null
        ? null
        : _categories.firstWhere(
            (c) => c.id == categoryId,
            orElse: () => AppCategory(
              id: -1,
              name: t.categoryName ?? '',
              parentId: null,
              type: t.categoryType ?? CategoryType.expense,
              color: null,
            ),
          );
    final sub = subcategoryId == null
        ? null
        : _categories.firstWhere(
            (c) => c.id == subcategoryId,
            orElse: () => AppCategory(
              id: -1,
              name: t.subcategoryName ?? '',
              parentId: null,
              type: t.categoryType ?? CategoryType.expense,
              color: null,
            ),
          );
    _transactions[idx] = AppTransaction(
      id: t.id,
      date: t.date,
      description: t.description,
      amount: t.amount,
      accountId: t.accountId,
      accountName: t.accountName,
      categoryId: cat?.id == -1 ? categoryId : categoryId,
      categoryName: cat?.name,
      categoryType: cat?.type,
      subcategoryId: sub?.id == -1 ? subcategoryId : subcategoryId,
      subcategoryName: sub?.name,
      source: t.source,
      notes: t.notes,
    );
    notifyListeners();
  }
}
