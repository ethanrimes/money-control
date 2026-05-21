import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../data/dashboard_store.dart';
import '../data/models.dart';
import '../theme.dart';
import '../widgets/money_text.dart';
import '../widgets/section_card.dart';

class TransactionsPage extends StatefulWidget {
  const TransactionsPage({super.key});

  @override
  State<TransactionsPage> createState() => _TransactionsPageState();
}

enum _Period { all, ytd, m1, m3, m6, custom }

enum _SortKey { date, amount, description }

class _TransactionsPageState extends State<TransactionsPage> {
  String _text = '';
  int? _accountFilter; // null = all, -1 = uncategorized
  int? _categoryFilter; // null = all, -1 = uncategorized
  bool _uncategorizedCat = false;
  _Period _period = _Period.all;
  DateTimeRange? _customRange;
  _SortKey _sortKey = _SortKey.date;
  bool _sortDesc = true;
  final Set<int> _selected = <int>{};

  @override
  Widget build(BuildContext context) {
    final store = context.watch<DashboardStore>();
    final visible = _sort(_filter(store.transactions));

    return SafeArea(
      child: CustomScrollView(
        slivers: [
          SliverAppBar.large(
            title: const Text('Transactions'),
            actions: [
              IconButton(
                tooltip: 'Sort',
                icon: const Icon(CupertinoIcons.arrow_up_arrow_down),
                onPressed: _openSortSheet,
              ),
              IconButton(
                tooltip: 'Refresh',
                icon: const Icon(CupertinoIcons.arrow_clockwise),
                onPressed: store.loading ? null : () => store.refresh(),
              ),
            ],
          ),
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
            sliver: SliverToBoxAdapter(
              child: SectionCard(
                title: 'Filters',
                subtitle:
                    '${visible.length} of ${store.transactions.length} shown · sorted by ${_sortLabel(_sortKey)} ${_sortDesc ? "↓" : "↑"}',
                child: _Filters(
                  text: _text,
                  onTextChanged: (v) => setState(() => _text = v),
                  period: _period,
                  customRange: _customRange,
                  onPeriod: _setPeriod,
                  accounts: _distinctAccounts(store.transactions),
                  accountFilter: _accountFilter,
                  onAccount: (a) => setState(() => _accountFilter = a),
                  categories: store.categoryTree,
                  uncategorizedCat: _uncategorizedCat,
                  categoryFilter: _categoryFilter,
                  onCategory: (c, unc) => setState(() {
                    _categoryFilter = c;
                    _uncategorizedCat = unc;
                  }),
                ),
              ),
            ),
          ),
          if (_selected.isNotEmpty)
            SliverPadding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              sliver: SliverToBoxAdapter(
                child: _BulkBar(
                  selectedCount: _selected.length,
                  onClear: () => setState(_selected.clear),
                  onApply: (catId, subId) => _applyBulk(catId, subId),
                  categories: store.categoryTree,
                ),
              ),
            ),
          if (store.loading && visible.isEmpty)
            const SliverFillRemaining(
              child: Center(child: CircularProgressIndicator()),
            )
          else if (visible.isEmpty)
            const SliverFillRemaining(
              hasScrollBody: false,
              child: EmptyState(
                icon: CupertinoIcons.tray,
                title: 'No transactions match',
                message: 'Try clearing filters or pulling to refresh.',
              ),
            )
          else
            SliverList.builder(
              itemCount: visible.length,
              itemBuilder: (ctx, i) {
                final t = visible[i];
                return _TxnTile(
                  t: t,
                  selected: _selected.contains(t.id),
                  onTap: () {
                    if (_selected.isNotEmpty) {
                      setState(() {
                        if (_selected.contains(t.id)) {
                          _selected.remove(t.id);
                        } else {
                          _selected.add(t.id);
                        }
                      });
                    } else {
                      _openCategorize(t);
                    }
                  },
                  onLongPress: () => setState(() {
                    if (_selected.contains(t.id)) {
                      _selected.remove(t.id);
                    } else {
                      _selected.add(t.id);
                    }
                  }),
                );
              },
            ),
          const SliverPadding(padding: EdgeInsets.only(bottom: 24)),
        ],
      ),
    );
  }

  Future<void> _setPeriod(_Period p) async {
    if (p == _Period.custom) {
      final now = DateTime.now();
      final initial = _customRange ??
          DateTimeRange(
            start: DateTime(now.year, now.month - 1, now.day),
            end: now,
          );
      final picked = await showDateRangePicker(
        context: context,
        firstDate: DateTime(2000),
        lastDate: DateTime(now.year + 1, 12, 31),
        initialDateRange: initial,
      );
      if (picked != null) {
        setState(() {
          _period = _Period.custom;
          _customRange = picked;
        });
      }
    } else {
      setState(() {
        _period = p;
        _customRange = null;
      });
    }
  }

  Future<void> _openSortSheet() async {
    final result = await showModalBottomSheet<({_SortKey key, bool desc})>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Padding(
              padding: EdgeInsets.fromLTRB(16, 16, 16, 8),
              child: Text('Sort transactions',
                  style: TextStyle(fontWeight: FontWeight.w600)),
            ),
            for (final key in _SortKey.values) ...[
              ListTile(
                leading: const Icon(Icons.south),
                title: Text('${_sortLabel(key)} (newest/largest first)'),
                selected: _sortKey == key && _sortDesc,
                onTap: () =>
                    Navigator.of(ctx).pop((key: key, desc: true)),
              ),
              ListTile(
                leading: const Icon(Icons.north),
                title: Text('${_sortLabel(key)} (oldest/smallest first)'),
                selected: _sortKey == key && !_sortDesc,
                onTap: () =>
                    Navigator.of(ctx).pop((key: key, desc: false)),
              ),
            ],
          ],
        ),
      ),
    );
    if (result != null) {
      setState(() {
        _sortKey = result.key;
        _sortDesc = result.desc;
      });
    }
  }

  Future<void> _openCategorize(AppTransaction t) async {
    final store = context.read<DashboardStore>();
    final result = await showModalBottomSheet<_CategorizeResult>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => _CategorizeSheet(
        transaction: t,
        tree: store.categoryTree,
      ),
    );
    if (result == null) return;
    final repo = store.repo;
    store.patchTransactionLocal(t.id,
        categoryId: result.categoryId, subcategoryId: result.subcategoryId);
    try {
      await repo.patchTransactionCategory(
        t.id,
        categoryId: result.categoryId,
        subcategoryId: result.subcategoryId,
      );
      // Mirror the web app's auto-backfill: any other uncategorized
      // transaction with the same description gets the same labels.
      final backfilled = await repo.backfillCategoryByDescription(
        sourceTxnId: t.id,
        description: t.description,
        categoryId: result.categoryId,
        subcategoryId: result.subcategoryId,
      );
      if (mounted && backfilled > 0) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
                'Also categorized $backfilled matching uncategorized transaction${backfilled == 1 ? "" : "s"}.'),
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to save: $e')),
        );
      }
    } finally {
      await store.refresh();
    }
  }

  Future<void> _applyBulk(int? catId, int? subId) async {
    final store = context.read<DashboardStore>();
    final ids = _selected.toList();
    try {
      await store.repo.bulkPatchTransactions(
        ids: ids,
        categoryId: catId,
        subcategoryId: subId,
      );
      setState(_selected.clear);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Updated ${ids.length} transactions')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed: $e')),
        );
      }
    } finally {
      await store.refresh();
    }
  }

  List<AppTransaction> _filter(List<AppTransaction> all) {
    final today = DateTime.now();
    String? fromIso;
    String? toIso;
    String offsetIso(int months) {
      final d = DateTime(today.year, today.month - months, today.day);
      return d.toIso8601String().substring(0, 10);
    }

    switch (_period) {
      case _Period.all:
        break;
      case _Period.ytd:
        fromIso = '${today.year}-01-01';
        break;
      case _Period.m1:
        fromIso = offsetIso(1);
        break;
      case _Period.m3:
        fromIso = offsetIso(3);
        break;
      case _Period.m6:
        fromIso = offsetIso(6);
        break;
      case _Period.custom:
        final r = _customRange;
        if (r != null) {
          fromIso = r.start.toIso8601String().substring(0, 10);
          toIso = r.end.toIso8601String().substring(0, 10);
        }
        break;
    }
    final todayIso = today.toIso8601String().substring(0, 10);

    final q = _text.trim().toLowerCase();
    return all.where((r) {
      if (q.isNotEmpty) {
        final hay = [
          r.description,
          r.categoryName ?? '',
          r.subcategoryName ?? '',
          r.accountName ?? '',
        ].join(' ').toLowerCase();
        if (!hay.contains(q)) return false;
      }
      if (_accountFilter != null && r.accountId != _accountFilter) return false;
      if (_uncategorizedCat && r.categoryId != null) return false;
      if (_categoryFilter != null) {
        if (r.categoryId != _categoryFilter &&
            r.subcategoryId != _categoryFilter) {
          return false;
        }
      }
      if (fromIso != null && r.date.compareTo(fromIso) < 0) return false;
      final upper = toIso ?? todayIso;
      if (r.date.compareTo(upper) > 0) return false;
      return true;
    }).toList();
  }

  List<AppTransaction> _sort(List<AppTransaction> rows) {
    rows.sort((a, b) {
      int cmp;
      switch (_sortKey) {
        case _SortKey.date:
          cmp = a.date.compareTo(b.date);
          if (cmp == 0) cmp = a.id.compareTo(b.id);
          break;
        case _SortKey.amount:
          cmp = a.amount.compareTo(b.amount);
          break;
        case _SortKey.description:
          cmp = a.description.toLowerCase().compareTo(b.description.toLowerCase());
          break;
      }
      return _sortDesc ? -cmp : cmp;
    });
    return rows;
  }

  static String _sortLabel(_SortKey k) {
    switch (k) {
      case _SortKey.date:
        return 'Date';
      case _SortKey.amount:
        return 'Amount';
      case _SortKey.description:
        return 'Description';
    }
  }

  List<({int id, String name})> _distinctAccounts(List<AppTransaction> rows) {
    final m = <int, String>{};
    for (final r in rows) {
      if (r.accountName != null && r.accountName!.isNotEmpty) {
        m[r.accountId] = r.accountName!;
      }
    }
    final out = m.entries.map((e) => (id: e.key, name: e.value)).toList()
      ..sort((a, b) => a.name.compareTo(b.name));
    return out;
  }
}

class _Filters extends StatelessWidget {
  const _Filters({
    required this.text,
    required this.onTextChanged,
    required this.period,
    required this.customRange,
    required this.onPeriod,
    required this.accounts,
    required this.accountFilter,
    required this.onAccount,
    required this.categories,
    required this.uncategorizedCat,
    required this.categoryFilter,
    required this.onCategory,
  });

  final String text;
  final ValueChanged<String> onTextChanged;
  final _Period period;
  final DateTimeRange? customRange;
  final ValueChanged<_Period> onPeriod;
  final List<({int id, String name})> accounts;
  final int? accountFilter;
  final ValueChanged<int?> onAccount;
  final List<CategoryNodeLite> categories;
  final bool uncategorizedCat;
  final int? categoryFilter;
  final void Function(int? id, bool unc) onCategory;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TextField(
          decoration: const InputDecoration(
            hintText: 'Search description, account, category…',
            prefixIcon: Icon(Icons.search, size: 20),
            isDense: true,
          ),
          onChanged: onTextChanged,
        ),
        const SizedBox(height: 10),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final p in _Period.values)
              ChoiceChip(
                label: Text(p == _Period.custom && customRange != null
                    ? '${_fmtShort(customRange!.start)} → ${_fmtShort(customRange!.end)}'
                    : _periodLabel(p)),
                selected: period == p,
                onSelected: (_) => onPeriod(p),
              ),
          ],
        ),
        const SizedBox(height: 10),
        DropdownButtonFormField<int?>(
          value: accountFilter,
          decoration: const InputDecoration(labelText: 'Account', isDense: true),
          items: [
            const DropdownMenuItem(value: null, child: Text('All accounts')),
            for (final a in accounts)
              DropdownMenuItem(value: a.id, child: Text(a.name)),
          ],
          onChanged: onAccount,
        ),
        const SizedBox(height: 8),
        DropdownButtonFormField<String>(
          value: uncategorizedCat
              ? 'uncat'
              : (categoryFilter == null ? 'all' : categoryFilter.toString()),
          decoration: const InputDecoration(labelText: 'Category', isDense: true),
          items: [
            const DropdownMenuItem(value: 'all', child: Text('All categories')),
            const DropdownMenuItem(value: 'uncat', child: Text('— Uncategorized —')),
            for (final top in categories) ...[
              DropdownMenuItem(
                value: top.category.id.toString(),
                child: Text(top.category.name),
              ),
              for (final sub in top.subcategories)
                DropdownMenuItem(
                  value: sub.id.toString(),
                  child: Text('  ↳ ${top.category.name} / ${sub.name}'),
                ),
            ],
          ],
          onChanged: (v) {
            if (v == 'all') {
              onCategory(null, false);
            } else if (v == 'uncat') {
              onCategory(null, true);
            } else if (v != null) {
              onCategory(int.parse(v), false);
            }
          },
        ),
      ],
    );
  }

  static String _periodLabel(_Period p) {
    switch (p) {
      case _Period.all:
        return 'All time';
      case _Period.ytd:
        return 'YTD';
      case _Period.m1:
        return '1 mo';
      case _Period.m3:
        return '3 mo';
      case _Period.m6:
        return '6 mo';
      case _Period.custom:
        return 'Custom…';
    }
  }
}

/// Lightweight alias so widgets in this file don't import the model file's
/// public `CategoryNode` directly (avoids cyclic-import risk if widgets are
/// later moved).
typedef CategoryNodeLite = CategoryNode;

String _fmtShort(DateTime d) =>
    '${d.year}-${d.month.toString().padLeft(2, "0")}-${d.day.toString().padLeft(2, "0")}';

class _TxnTile extends StatelessWidget {
  const _TxnTile({
    required this.t,
    required this.selected,
    required this.onTap,
    required this.onLongPress,
  });

  final AppTransaction t;
  final bool selected;
  final VoidCallback onTap;
  final VoidCallback onLongPress;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodySmall;
    final categoryLabel = t.subcategoryName ?? t.categoryName ?? 'Uncategorized';
    return Material(
      color:
          selected ? context.accentColor.withValues(alpha: 0.10) : Colors.transparent,
      child: InkWell(
        onTap: onTap,
        onLongPress: onLongPress,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (selected)
                Padding(
                  padding: const EdgeInsets.only(right: 10, top: 2),
                  child: Icon(CupertinoIcons.check_mark_circled_solid,
                      color: context.accentColor, size: 20),
                ),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(t.description,
                        style: theme.textTheme.bodyMedium,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis),
                    const SizedBox(height: 4),
                    Wrap(
                      spacing: 8,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        Text(t.date, style: muted),
                        if (t.accountName != null && t.accountName!.isNotEmpty)
                          Text('· ${t.accountName}', style: muted),
                        Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 6, vertical: 2),
                          decoration: BoxDecoration(
                            color: context.borderColor.withValues(alpha: 0.5),
                            borderRadius: BorderRadius.circular(4),
                          ),
                          child: Text(
                            categoryLabel,
                            style: theme.textTheme.labelSmall,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 12),
              MoneyText(
                t.amount,
                colorize: true,
                sign: t.amount > 0,
                style: theme.textTheme.bodyMedium,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _BulkBar extends StatelessWidget {
  const _BulkBar({
    required this.selectedCount,
    required this.onClear,
    required this.onApply,
    required this.categories,
  });

  final int selectedCount;
  final VoidCallback onClear;
  final void Function(int? catId, int? subId) onApply;
  final List<CategoryNodeLite> categories;

  @override
  Widget build(BuildContext context) {
    return SectionCard(
      title: '$selectedCount selected',
      trailing: TextButton(onPressed: onClear, child: const Text('Clear')),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          OutlinedButton.icon(
            icon: const Icon(Icons.label_outline),
            label: const Text('Categorize selected'),
            onPressed: () async {
              final result = await showModalBottomSheet<_CategorizeResult>(
                context: context,
                isScrollControlled: true,
                builder: (ctx) => _CategorizeSheet(
                  transaction: null,
                  tree: categories,
                ),
              );
              if (result != null) {
                onApply(result.categoryId, result.subcategoryId);
              }
            },
          ),
        ],
      ),
    );
  }
}

class _CategorizeResult {
  _CategorizeResult({this.categoryId, this.subcategoryId});
  final int? categoryId;
  final int? subcategoryId;
}

class _CategorizeSheet extends StatelessWidget {
  const _CategorizeSheet({required this.transaction, required this.tree});

  final AppTransaction? transaction;
  final List<CategoryNodeLite> tree;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: DraggableScrollableSheet(
        initialChildSize: 0.85,
        minChildSize: 0.4,
        maxChildSize: 0.95,
        expand: false,
        builder: (ctx, scrollCtl) {
          return ListView(
            controller: scrollCtl,
            padding: const EdgeInsets.fromLTRB(16, 24, 16, 32),
            children: [
              if (transaction != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Text(
                    transaction!.description,
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                ),
              Text(
                'Choose category',
                style: Theme.of(context).textTheme.bodySmall,
              ),
              const SizedBox(height: 8),
              ListTile(
                title: const Text('— Uncategorized —'),
                leading: const Icon(Icons.remove_circle_outline),
                onTap: () => Navigator.of(context).pop(_CategorizeResult()),
              ),
              const Divider(),
              for (final top in tree) ...[
                ListTile(
                  title: Text(top.category.name,
                      style: const TextStyle(fontWeight: FontWeight.w600)),
                  onTap: () => Navigator.of(context).pop(
                    _CategorizeResult(categoryId: top.category.id),
                  ),
                ),
                for (final sub in top.subcategories)
                  Padding(
                    padding: const EdgeInsets.only(left: 16),
                    child: ListTile(
                      dense: true,
                      title: Text('↳ ${sub.name}'),
                      onTap: () => Navigator.of(context).pop(
                        _CategorizeResult(
                          categoryId: top.category.id,
                          subcategoryId: sub.id,
                        ),
                      ),
                    ),
                  ),
              ],
            ],
          );
        },
      ),
    );
  }
}
