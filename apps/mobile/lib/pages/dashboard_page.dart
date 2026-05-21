import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../analytics/analytics.dart';
import '../data/backend_api.dart';
import '../data/dashboard_store.dart';
import '../theme.dart';
import '../widgets/category_bars.dart';
import '../widgets/money_text.dart';
import '../widgets/section_card.dart';
import '../widgets/spend_chart.dart';
import 'categories_page.dart';

class DashboardPage extends StatelessWidget {
  const DashboardPage({super.key});

  @override
  Widget build(BuildContext context) {
    final store = context.watch<DashboardStore>();
    final api = context.read<BackendApi>();
    final theme = Theme.of(context);
    return SafeArea(
      child: CustomScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        slivers: [
          SliverAppBar.large(
            title: const Text('MoneyControl'),
            actions: [
              IconButton(
                tooltip: 'Sync banks + refresh',
                icon: store.loading
                    ? const SizedBox(
                        height: 18,
                        width: 18,
                        child: CircularProgressIndicator(strokeWidth: 2.4))
                    : const Icon(CupertinoIcons.arrow_clockwise),
                onPressed: store.loading
                    ? null
                    : () => _syncAndRefresh(context, api, store),
              ),
              const SizedBox(width: 4),
            ],
          ),
          if (store.error != null)
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: _ErrorBox(error: store.error!),
              ),
            ),
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
            sliver: SliverList.list(
              children: [
                _StatsRow(store: store),
                const SizedBox(height: 16),
                _NetCashCard(store: store),
                const SizedBox(height: 16),
                _SpendCard(store: store),
                const SizedBox(height: 16),
                _CategoryCard(store: store),
                if (store.loading && store.transactions.isEmpty) ...[
                  const SizedBox(height: 16),
                  const Center(child: Padding(
                    padding: EdgeInsets.all(24),
                    child: CircularProgressIndicator(),
                  )),
                ],
                const SizedBox(height: 24),
                Text(
                  'Last refreshed: ${_refreshLabel(store.lastLoadedAt)}',
                  style: theme.textTheme.labelSmall,
                  textAlign: TextAlign.center,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  static String _refreshLabel(DateTime t) {
    if (t.millisecondsSinceEpoch == 0) return '—';
    final h = t.hour.toString().padLeft(2, '0');
    final m = t.minute.toString().padLeft(2, '0');
    return '$h:$m local';
  }

  static Future<void> _syncAndRefresh(
    BuildContext context,
    BackendApi api,
    DashboardStore store,
  ) async {
    final messenger = ScaffoldMessenger.of(context);
    // Always do the local refresh first so the user sees the spinner go away
    // even if the backend sync errors (e.g. backend not deployed).
    try {
      final r = await api.syncAll();
      await store.refresh();
      messenger.showSnackBar(
        SnackBar(
          content: Text(
            r.transactions == 0
                ? 'Up to date.'
                : 'Synced ${r.transactions} new transaction${r.transactions == 1 ? "" : "s"}.',
          ),
        ),
      );
    } catch (e) {
      // Fall back to a local-only refresh; the user can still see categorized
      // data even when the aggregator endpoint is unreachable.
      await store.refresh();
      messenger.showSnackBar(
        SnackBar(content: Text('Local refresh only — bank sync failed: $e')),
      );
    }
  }
}

class _StatsRow extends StatelessWidget {
  const _StatsRow({required this.store});

  final DashboardStore store;

  @override
  Widget build(BuildContext context) {
    final stats = computeMtdStats(store.transactions);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: StatTile(
            label: 'MTD spend',
            valueColor: AppPalette.negative,
            value: MoneyText(-stats.mtdSpend, style: Theme.of(context).textTheme.headlineMedium),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: StatTile(
            label: 'MTD income',
            valueColor: AppPalette.positive,
            value: MoneyText(stats.mtdIncome, sign: true, style: Theme.of(context).textTheme.headlineMedium),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: StatTile(
            label: 'MTD transactions',
            value: Text(stats.mtdTransactionCount.toString()),
          ),
        ),
      ],
    );
  }
}

class _NetCashCard extends StatelessWidget {
  const _NetCashCard({required this.store});

  final DashboardStore store;

  @override
  Widget build(BuildContext context) {
    final nc = computeNetCash(store.accounts);
    final groups =
        groupAccounts(store.accounts).where((g) => g.kind != AccountGroupKind.seeded).toList();
    final theme = Theme.of(context);
    return SectionCard(
      title: 'Accounts',
      subtitle:
          '${formatUsd(nc.totalDepository)} cash · ${formatUsd(nc.totalCredit)} debt',
      trailing: MoneyText(
        nc.netCash,
        style: theme.textTheme.headlineMedium?.copyWith(
          color: nc.netCash < 0 ? AppPalette.negative : null,
        ),
      ),
      child: groups.isEmpty
          ? Padding(
              padding: const EdgeInsets.symmetric(vertical: 16),
              child: Text(
                'No accounts yet. Link an account or import via the web app.',
                style: theme.textTheme.bodySmall,
              ),
            )
          : Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (final g in groups) ...[
                  Row(
                    children: [
                      Expanded(
                        child: Text(g.institutionName,
                            style: theme.textTheme.titleMedium),
                      ),
                      Container(
                        padding:
                            const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                        decoration: BoxDecoration(
                          color: context.borderColor.withValues(alpha: 0.5),
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: Text(
                          _kindLabel(g.kind),
                          style: theme.textTheme.labelSmall?.copyWith(
                            letterSpacing: 0.5,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  for (final a in g.accounts)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 4),
                      child: Row(
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(a.name, style: theme.textTheme.bodyMedium),
                                if (a.lastFour != null && a.lastFour!.isNotEmpty)
                                  Text(
                                    '${a.type.name} · ••${a.lastFour}',
                                    style: theme.textTheme.bodySmall,
                                  )
                                else
                                  Text(a.type.name, style: theme.textTheme.bodySmall),
                              ],
                            ),
                          ),
                          MoneyText(
                            a.signedBalance,
                            sign: true,
                            colorize: true,
                            style: theme.textTheme.bodyMedium,
                          ),
                        ],
                      ),
                    ),
                  const Divider(height: 24),
                ],
              ],
            ),
    );
  }

  static String _kindLabel(AccountGroupKind k) {
    switch (k) {
      case AccountGroupKind.teller:
        return 'TELLER';
      case AccountGroupKind.plaid:
        return 'PLAID';
      case AccountGroupKind.manual:
        return 'MANUAL';
      case AccountGroupKind.seeded:
        return 'IMPORTED';
    }
  }
}

class _SpendCard extends StatefulWidget {
  const _SpendCard({required this.store});
  final DashboardStore store;

  @override
  State<_SpendCard> createState() => _SpendCardState();
}

class _SpendCardState extends State<_SpendCard> {
  late DateTime _month;

  @override
  void initState() {
    super.initState();
    final now = DateTime.now();
    _month = DateTime(now.year, now.month);
  }

  @override
  Widget build(BuildContext context) {
    final store = widget.store;
    final theme = Theme.of(context);
    final series = computeSpendSeries(
      all: store.transactions,
      year: _month.year,
      month1to12: _month.month,
      monthlySavingsTarget: store.monthlySavingsTarget,
    );
    final spent = series.spentSoFar;
    final budget = series.monthlyBudget;
    return SectionCard(
      title: 'Spending vs budget',
      subtitle:
          'Budget ${formatUsd(budget)} · trailing income ${formatUsd(series.trailingMonthlyIncome)} · savings target ${formatUsd(series.monthlySavingsTarget)}',
      trailing: _MonthPicker(
        value: _month,
        onChanged: (m) => setState(() => _month = m),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Spent so far', style: theme.textTheme.bodySmall),
                    const SizedBox(height: 2),
                    MoneyText(
                      spent,
                      style: theme.textTheme.titleLarge,
                    ),
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                decoration: BoxDecoration(
                  color: spent > budget
                      ? AppPalette.negative.withValues(alpha: 0.12)
                      : AppPalette.positive.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  spent > budget
                      ? 'Over budget by ${formatUsd(spent - budget)}'
                      : 'Under budget by ${formatUsd(budget - spent)}',
                  style: theme.textTheme.labelSmall?.copyWith(
                    color: spent > budget ? AppPalette.negative : AppPalette.positive,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          SpendChart(series: series),
          const SizedBox(height: 8),
          ChartLegend(items: [
            (context.accentColor, 'Actual MTD'),
            (AppPalette.positive, 'Budget'),
            (context.mutedText, 'Historical avg'),
          ]),
        ],
      ),
    );
  }
}

class _CategoryCard extends StatefulWidget {
  const _CategoryCard({required this.store});
  final DashboardStore store;

  @override
  State<_CategoryCard> createState() => _CategoryCardState();
}

class _CategoryCardState extends State<_CategoryCard> {
  late DateTime _month;

  @override
  void initState() {
    super.initState();
    final n = DateTime.now();
    _month = DateTime(n.year, n.month);
  }

  @override
  Widget build(BuildContext context) {
    final bars = computeByCategory(
      all: widget.store.transactions,
      year: _month.year,
      month1to12: _month.month,
    );
    return SectionCard(
      title: 'Spending by category',
      subtitle:
          'Absolute spend per category, this month. Orange tick = trailing 6-month average.',
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          _MonthPicker(
            value: _month,
            onChanged: (m) => setState(() => _month = m),
          ),
          IconButton(
            tooltip: 'Manage categories',
            icon: const Icon(Icons.tune),
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => const CategoriesPage()),
            ),
          ),
        ],
      ),
      child: CategoryBarChart(bars: bars),
    );
  }
}

class _MonthPicker extends StatelessWidget {
  const _MonthPicker({required this.value, required this.onChanged});

  final DateTime value;
  final ValueChanged<DateTime> onChanged;

  @override
  Widget build(BuildContext context) {
    final label = '${value.year}-${value.month.toString().padLeft(2, '0')}';
    return InkWell(
      onTap: () async {
        final picked = await showModalBottomSheet<DateTime>(
          context: context,
          builder: (ctx) => _MonthPickerSheet(initial: value),
        );
        if (picked != null) onChanged(picked);
      },
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: context.borderColor.withValues(alpha: 0.4),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(label, style: Theme.of(context).textTheme.bodySmall),
            const SizedBox(width: 4),
            const Icon(Icons.expand_more, size: 14),
          ],
        ),
      ),
    );
  }
}

class _MonthPickerSheet extends StatelessWidget {
  const _MonthPickerSheet({required this.initial});
  final DateTime initial;

  @override
  Widget build(BuildContext context) {
    final months = <DateTime>[];
    final start = DateTime(2026, 1);
    final now = DateTime.now();
    for (var y = now.year; y >= start.year; y--) {
      final monthEnd = y == now.year ? now.month : 12;
      final monthStart = y == start.year ? start.month : 1;
      for (var m = monthEnd; m >= monthStart; m--) {
        months.add(DateTime(y, m));
      }
    }
    return SafeArea(
      child: SizedBox(
        height: 400,
        child: ListView.builder(
          itemCount: months.length,
          itemBuilder: (ctx, i) {
            final m = months[i];
            final label =
                '${m.year}-${m.month.toString().padLeft(2, '0')}';
            return ListTile(
              title: Text(label),
              selected: m.year == initial.year && m.month == initial.month,
              onTap: () => Navigator.of(ctx).pop(m),
            );
          },
        ),
      ),
    );
  }
}

class _ErrorBox extends StatelessWidget {
  const _ErrorBox({required this.error});

  final Object error;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppPalette.negative.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppPalette.negative.withValues(alpha: 0.3)),
      ),
      child: Row(
        children: [
          const Icon(Icons.error_outline, color: AppPalette.negative),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              'Failed to load: $error',
              style: const TextStyle(color: AppPalette.negative),
            ),
          ),
        ],
      ),
    );
  }
}
