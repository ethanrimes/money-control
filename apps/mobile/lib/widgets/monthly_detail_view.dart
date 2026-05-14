import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../analytics/analytics.dart';
import '../theme.dart';
import 'money_text.dart';
import 'section_card.dart';

class MonthlyDetailView extends StatefulWidget {
  const MonthlyDetailView({
    super.key,
    required this.detail,
    required this.unitLabel,
    this.summaryMode = MonthlySummaryMode.total,
  });

  final MonthlyDetail detail;
  final String unitLabel;
  final MonthlySummaryMode summaryMode;

  @override
  State<MonthlyDetailView> createState() => _MonthlyDetailViewState();
}

enum MonthlySummaryMode { total, average }

class _MonthlyDetailViewState extends State<MonthlyDetailView> {
  final Set<String> _expanded = <String>{};

  @override
  void initState() {
    super.initState();
    // Default: every month expanded — mirrors web behaviour.
    _expanded.addAll(widget.detail.months.map((m) => m.month));
  }

  @override
  void didUpdateWidget(covariant MonthlyDetailView old) {
    super.didUpdateWidget(old);
    if (old.detail != widget.detail) {
      _expanded
        ..clear()
        ..addAll(widget.detail.months.map((m) => m.month));
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final d = widget.detail;
    final headline = widget.summaryMode == MonthlySummaryMode.average
        ? d.averageOverCompletedMonths
        : d.totalOverCompletedMonths;
    final subPrefix = widget.summaryMode == MonthlySummaryMode.average
        ? 'total'
        : 'avg';
    final subValue = widget.summaryMode == MonthlySummaryMode.average
        ? d.totalOverCompletedMonths
        : d.averageOverCompletedMonths;

    return SectionCard(
      title: widget.summaryMode == MonthlySummaryMode.average
          ? 'Average per month'
          : 'All completed months',
      subtitle:
          '${d.completedMonthCount} completed month${d.completedMonthCount == 1 ? '' : 's'}'
          '${d.completedMonthCount > 0 ? ' · $subPrefix ${formatUsd(subValue)}' : ''}',
      trailing: MoneyText(
        headline,
        style: theme.textTheme.headlineMedium,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (d.months.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 24),
              child: Text(
                'No ${widget.unitLabel} transactions found yet.',
                style: theme.textTheme.bodySmall,
                textAlign: TextAlign.center,
              ),
            ),
          for (final m in d.months)
            _MonthBlock(
              section: m,
              expanded: _expanded.contains(m.month),
              onToggle: () {
                setState(() {
                  if (_expanded.contains(m.month)) {
                    _expanded.remove(m.month);
                  } else {
                    _expanded.add(m.month);
                  }
                });
              },
              unitLabel: widget.unitLabel,
            ),
        ],
      ),
    );
  }
}

class _MonthBlock extends StatelessWidget {
  const _MonthBlock({
    required this.section,
    required this.expanded,
    required this.onToggle,
    required this.unitLabel,
  });

  final MonthSection section;
  final bool expanded;
  final VoidCallback onToggle;
  final String unitLabel;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodySmall?.color;
    final dateFmt = DateFormat('MMMM y');
    final monthLabel = () {
      final parts = section.month.split('-');
      if (parts.length < 2) return section.month;
      final y = int.tryParse(parts[0]);
      final m = int.tryParse(parts[1]);
      if (y == null || m == null) return section.month;
      return dateFmt.format(DateTime(y, m));
    }();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        InkWell(
          onTap: onToggle,
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 10),
            child: Row(
              children: [
                AnimatedRotation(
                  turns: expanded ? 0.25 : 0,
                  duration: const Duration(milliseconds: 180),
                  child: Icon(Icons.chevron_right, size: 20, color: muted),
                ),
                const SizedBox(width: 4),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(monthLabel, style: theme.textTheme.titleMedium),
                      const SizedBox(height: 2),
                      Row(
                        children: [
                          Text(
                            '${section.transactions.length} $unitLabel transaction${section.transactions.length == 1 ? '' : 's'}',
                            style: theme.textTheme.bodySmall,
                          ),
                          if (!section.isComplete) ...[
                            const SizedBox(width: 8),
                            _Badge(label: 'IN PROGRESS', color: AppPalette.lightAccent),
                          ],
                        ],
                      ),
                    ],
                  ),
                ),
                MoneyText(
                  section.total,
                  style: theme.textTheme.titleMedium?.copyWith(
                    color: section.isComplete ? null : muted,
                  ),
                ),
              ],
            ),
          ),
        ),
        if (expanded) ...[
          const Divider(height: 0, thickness: 0.5),
          for (final t in section.transactions) _MonthlyTxnRow(t: t),
          const Divider(height: 0, thickness: 0.5),
          const SizedBox(height: 8),
        ] else
          const Divider(height: 0, thickness: 0.5),
      ],
    );
  }
}

class _MonthlyTxnRow extends StatelessWidget {
  const _MonthlyTxnRow({required this.t});

  final MonthlyTransaction t;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodySmall;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 64,
            child: Text(
              t.date.length >= 10 ? t.date.substring(5) : t.date,
              style: muted?.copyWith(
                fontFeatures: const [FontFeature.tabularFigures()],
              ),
            ),
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  t.description,
                  style: theme.textTheme.bodyMedium,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 2),
                Text(
                  [t.subcategoryName ?? t.categoryName, t.accountName]
                      .where((x) => x != null && x.isNotEmpty)
                      .join(' · '),
                  style: muted,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          MoneyText(t.amount.abs(), style: theme.textTheme.bodyMedium),
        ],
      ),
    );
  }
}

class _Badge extends StatelessWidget {
  const _Badge({required this.label, required this.color});

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(4),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontSize: 9,
          fontWeight: FontWeight.w600,
          letterSpacing: 0.5,
        ),
      ),
    );
  }
}
