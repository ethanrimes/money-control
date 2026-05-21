// Supabase-backed repositories. Every query is implicitly tenant-scoped: RLS
// in supabase/migrations/0001_init.sql restricts each table to rows where
// `user_id = public.current_user_id()`, and the Supabase client attaches the
// signed-in user's JWT to every request — Postgres reads `request.jwt.claims`
// from that JWT and `current_user_id()` returns the `sub` claim.
//
// We rely on RLS — we do NOT need to (and should not) duplicate `.eq('user_id', ...)`
// in queries. The service-role key, which would bypass RLS, never touches the
// device.

import 'package:supabase_flutter/supabase_flutter.dart';

import 'models.dart';

class MoneyControlRepo {
  MoneyControlRepo(this._client);

  final SupabaseClient _client;
  PostgrestClient get _db => _client.rest;

  // ---------------------------------------------------------------------------
  // Accounts
  // ---------------------------------------------------------------------------

  /// Pull every account the signed-in user owns, with their *latest* balance
  /// joined in via `balances` ordered by date desc, limit 1. PostgREST's
  /// resource embedding handles the nested fetch in a single request.
  Future<List<Account>> listAccounts() async {
    final data = await _db
        .from('accounts')
        .select(
          'id, name, type, subtype, institution, last_four, '
          'teller_enrollment_id, plaid_item_id, '
          'balances ( current, as_of_date )',
        )
        .order('as_of_date', referencedTable: 'balances', ascending: false)
        .limit(1, referencedTable: 'balances')
        .order('name');
    return (data as List)
        .map((e) => Account.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<void> updateAccountBalance(int accountId, double current,
      [double? available]) async {
    final today = DateTime.now().toIso8601String().substring(0, 10);
    // Upsert by (account_id, as_of_date). Per the schema's unique index.
    await _db.from('balances').upsert(
      {
        'account_id': accountId,
        'as_of_date': today,
        'current': current,
        'available': available,
      },
      onConflict: 'account_id,as_of_date',
    );
  }

  /// Create a manual account (no Teller/Plaid linkage). Defaults `subtype`
  /// to a non-null sentinel so `Account.isSeeded` returns false — i.e. it
  /// shows up as a manual account, not a seeded/imported one.
  Future<Account> createManualAccount({
    required String name,
    AccountType type = AccountType.depository,
  }) async {
    final row = await _db
        .from('accounts')
        .insert({
          'name': name,
          'type': type.name,
          'subtype': 'manual',
        })
        .select(
          'id, name, type, subtype, institution, last_four, '
          'teller_enrollment_id, plaid_item_id, '
          'balances ( current, as_of_date )',
        )
        .single();
    return Account.fromJson(row);
  }

  // ---------------------------------------------------------------------------
  // Categories
  // ---------------------------------------------------------------------------

  Future<List<AppCategory>> listCategories() async {
    final data = await _db.from('categories').select().order('name');
    return (data as List)
        .map((e) => AppCategory.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// Returns categories grouped into trees: each top-level category followed
  /// by its subcategories in alpha order. The web app uses the same shape.
  List<CategoryNode> buildCategoryTree(List<AppCategory> flat) {
    final byId = {for (final c in flat) c.id: c};
    final children = <int, List<AppCategory>>{};
    for (final c in flat) {
      final pid = c.parentId;
      if (pid != null) {
        (children[pid] ??= <AppCategory>[]).add(c);
      }
    }
    final tops = flat
        .where((c) => c.parentId == null || !byId.containsKey(c.parentId))
        .toList()
      ..sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
    return tops.map((top) {
      final kids = (children[top.id] ?? <AppCategory>[])
        ..sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
      return CategoryNode(category: top, subcategories: kids);
    }).toList();
  }

  Future<AppCategory> createCategory({
    required String name,
    int? parentId,
    CategoryType type = CategoryType.expense,
  }) async {
    final row = await _db
        .from('categories')
        .insert({
          'name': name,
          'parent_id': parentId,
          'type': type.name,
        })
        .select()
        .single();
    return AppCategory.fromJson(row);
  }

  Future<AppCategory> updateCategory(int id,
      {String? name, CategoryType? type}) async {
    final patch = <String, dynamic>{};
    if (name != null) patch['name'] = name;
    if (type != null) patch['type'] = type.name;
    final row = await _db
        .from('categories')
        .update(patch)
        .eq('id', id)
        .select()
        .single();
    return AppCategory.fromJson(row);
  }

  /// Delete a category. With `cascade: false`, any children are promoted to
  /// top-level first (their `parent_id` set to null). With `cascade: true`,
  /// children are deleted along with the parent (the schema FK is
  /// `on delete cascade`). Transactions referencing it become uncategorized
  /// via the existing `on delete set null` rule.
  Future<void> deleteCategory(int id, {bool cascade = false}) async {
    if (!cascade) {
      await _db
          .from('categories')
          .update({'parent_id': null}).eq('parent_id', id);
    }
    await _db.from('categories').delete().eq('id', id);
  }

  // ---------------------------------------------------------------------------
  // Transactions
  // ---------------------------------------------------------------------------

  /// Pull recent transactions joined with account and (sub)category names.
  /// The joined-resource aliasing relies on the FK names PostgREST exposes.
  Future<List<AppTransaction>> listTransactions({int limit = 1000}) async {
    final data = await _db
        .from('transactions')
        .select(
          'id, date, description, amount, account_id, source, notes, '
          'category_id, subcategory_id, '
          'accounts ( name, type ), '
          'category:categories!transactions_category_id_fkey ( name, type ), '
          'subcategory:categories!transactions_subcategory_id_fkey ( name, type )',
        )
        .order('date', ascending: false)
        .order('id', ascending: false)
        .limit(limit);
    return (data as List)
        .map((e) => AppTransaction.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<void> patchTransactionCategory(
    int id, {
    int? categoryId,
    int? subcategoryId,
  }) async {
    await _db.from('transactions').update({
      'category_id': categoryId,
      'subcategory_id': subcategoryId,
      'updated_at': DateTime.now().toUtc().toIso8601String(),
    }).eq('id', id);
  }

  /// Bulk-update many transactions to the same (category, subcategory). Used
  /// by the multi-select "Apply" action.
  Future<int> bulkPatchTransactions({
    required List<int> ids,
    int? categoryId,
    int? subcategoryId,
  }) async {
    if (ids.isEmpty) return 0;
    await _db.from('transactions').update({
      'category_id': categoryId,
      'subcategory_id': subcategoryId,
      'updated_at': DateTime.now().toUtc().toIso8601String(),
    }).inFilter('id', ids);
    return ids.length;
  }

  // ---------------------------------------------------------------------------
  // Budget settings
  // ---------------------------------------------------------------------------

  Future<BudgetSettings?> latestBudget() async {
    final rows = await _db
        .from('budget_settings')
        .select()
        .order('effective_from', ascending: false)
        .limit(1);
    final list = rows as List;
    if (list.isEmpty) return null;
    return BudgetSettings.fromJson(list.first as Map<String, dynamic>);
  }

  Future<BudgetSettings> upsertBudget({
    required double monthlySavingsTarget,
    String? effectiveFrom,
  }) async {
    final eff = effectiveFrom ??
        DateTime.now().toIso8601String().substring(0, 10);
    final row = await _db
        .from('budget_settings')
        .insert({
          'monthly_savings_target': monthlySavingsTarget,
          'effective_from': eff,
        })
        .select()
        .single();
    return BudgetSettings.fromJson(row);
  }

  // ---------------------------------------------------------------------------
  // Linked institutions (Teller / Plaid)
  // ---------------------------------------------------------------------------

  /// Drop a Teller enrollment. The schema's `on delete cascade` on
  /// `accounts.teller_enrollment_id` also drops every associated account
  /// (and through them, balances/transactions).
  Future<void> disconnectTellerEnrollment(int enrollmentId) async {
    await _db.from('teller_enrollments').delete().eq('id', enrollmentId);
  }

  /// Drop a Plaid item — same cascade story as Teller above.
  Future<void> disconnectPlaidItem(int plaidItemId) async {
    await _db.from('plaid_items').delete().eq('id', plaidItemId);
  }

  // ---------------------------------------------------------------------------
  // Categorization backfill (mobile-only port of the web server logic)
  // ---------------------------------------------------------------------------

  /// After categorizing one transaction, find every *other* uncategorized
  /// transaction whose description matches (case-insensitive, trimmed) and
  /// stamp the same (category, subcategory) on them. Returns the number of
  /// rows updated (excluding the originating one).
  ///
  /// The web app has equivalent logic on the server; this method gives the
  /// iOS app parity by running it from the client over RLS-scoped queries.
  Future<int> backfillCategoryByDescription({
    required int sourceTxnId,
    required String description,
    int? categoryId,
    int? subcategoryId,
  }) async {
    final needle = description.trim();
    if (needle.isEmpty) return 0;
    // PostgREST `ilike` does case-insensitive matching. Escape any wildcards
    // the user-entered description might contain so we get an exact match.
    final escaped = needle.replaceAll(r'\', r'\\').replaceAll('%', r'\%').replaceAll('_', r'\_');
    final rows = await _db
        .from('transactions')
        .select('id')
        .filter('category_id', 'is', null)
        .neq('id', sourceTxnId)
        .ilike('description', escaped);
    final ids = (rows as List)
        .map((e) => (e as Map<String, dynamic>)['id'] as int)
        .toList();
    if (ids.isEmpty) return 0;
    await _db.from('transactions').update({
      'category_id': categoryId,
      'subcategory_id': subcategoryId,
      'updated_at': DateTime.now().toUtc().toIso8601String(),
    }).inFilter('id', ids);
    return ids.length;
  }
}
