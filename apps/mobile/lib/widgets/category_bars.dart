import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';

import '../analytics/analytics.dart';
import '../theme.dart';
import 'money_text.dart';

class CategoryBarChart extends StatelessWidget {
  const CategoryBarChart({super.key, required this.bars, this.maxBars = 12});

  final List<CategoryBar> bars;
  final int maxBars;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.brightness == Brightness.dark
        ? AppPalette.darkMuted
        : AppPalette.lightMuted;
    final accent = theme.brightness == Brightness.dark
        ? AppPalette.darkAccent
        : AppPalette.lightAccent;
    final border = theme.brightness == Brightness.dark
        ? AppPalette.darkBorder
        : AppPalette.lightBorder;
    final visible = bars.take(maxBars).toList();
    if (visible.isEmpty) {
      return SizedBox(
        height: 80,
        child: Center(
          child: Text(
            'No spending this month yet.',
            style: theme.textTheme.bodySmall,
          ),
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final b in visible) ...[
          _CategoryRow(
            bar: b,
            accent: accent,
            muted: muted,
            border: border,
          ),
          const SizedBox(height: 10),
        ],
      ],
    );
  }
}

class _CategoryRow extends StatelessWidget {
  const _CategoryRow({
    required this.bar,
    required this.accent,
    required this.muted,
    required this.border,
  });

  final CategoryBar bar;
  final Color accent;
  final Color muted;
  final Color border;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final over = bar.currentSpend > bar.historicalAverage;
    final currentColor = over ? AppPalette.negative : accent;
    final scale =
        [bar.currentSpend, bar.historicalAverage].reduce((a, b) => a > b ? a : b);
    final curW = scale == 0 ? 0.0 : (bar.currentSpend / scale).clamp(0.0, 1.0);
    final histW = scale == 0 ? 0.0 : (bar.historicalAverage / scale).clamp(0.0, 1.0);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                bar.categoryName,
                style: theme.textTheme.bodyMedium,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            const SizedBox(width: 8),
            MoneyText(
              bar.currentSpend,
              expense: true,
              style: theme.textTheme.bodyMedium,
            ),
            const SizedBox(width: 12),
            Text(
              'avg ${formatUsd(bar.historicalAverage)}',
              style: theme.textTheme.labelSmall,
            ),
          ],
        ),
        const SizedBox(height: 6),
        Stack(
          children: [
            // Hist bar — drawn behind.
            FractionallySizedBox(
              widthFactor: histW,
              child: Container(
                height: 8,
                decoration: BoxDecoration(
                  color: muted.withValues(alpha: 0.35),
                  borderRadius: BorderRadius.circular(4),
                ),
              ),
            ),
            // Current bar — drawn on top, narrower or wider.
            FractionallySizedBox(
              widthFactor: curW,
              child: Container(
                height: 8,
                decoration: BoxDecoration(
                  color: currentColor,
                  borderRadius: BorderRadius.circular(4),
                ),
              ),
            ),
          ],
        ),
      ],
    );
  }
}

// Optional alternative: stacked horizontal bar chart via fl_chart. Kept for
// future use; the simpler row-based view above is more readable on phone.
class CategoryFlBarChart extends StatelessWidget {
  const CategoryFlBarChart({super.key, required this.bars});

  final List<CategoryBar> bars;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final accent = AppPalette.lightAccent;
    final maxV = bars.fold<double>(0, (m, b) => [m, b.currentSpend, b.historicalAverage].reduce((a, c) => a > c ? a : c));
    return SizedBox(
      height: bars.length * 28.0 + 32,
      child: BarChart(
        BarChartData(
          alignment: BarChartAlignment.spaceAround,
          maxY: maxV * 1.15,
          gridData: const FlGridData(show: false),
          borderData: FlBorderData(show: false),
          titlesData: FlTitlesData(
            leftTitles: AxisTitles(
              sideTitles: SideTitles(
                showTitles: true,
                reservedSize: 100,
                getTitlesWidget: (value, _) {
                  final i = value.toInt();
                  if (i < 0 || i >= bars.length) return const SizedBox.shrink();
                  return Padding(
                    padding: const EdgeInsets.only(right: 6),
                    child: Text(bars[i].categoryName, style: theme.textTheme.labelSmall),
                  );
                },
              ),
            ),
            rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
            topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
            bottomTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
          ),
          barGroups: [
            for (var i = 0; i < bars.length; i++)
              BarChartGroupData(
                x: i,
                barRods: [BarChartRodData(toY: bars[i].currentSpend, color: accent)],
              ),
          ],
        ),
      ),
    );
  }
}
