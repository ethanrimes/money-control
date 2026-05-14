import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';

import '../analytics/analytics.dart';
import '../theme.dart';
import 'money_text.dart';

class SpendChart extends StatelessWidget {
  const SpendChart({super.key, required this.series});

  final SpendSeries series;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted =
        theme.brightness == Brightness.dark ? AppPalette.darkMuted : AppPalette.lightMuted;
    final border = theme.brightness == Brightness.dark
        ? AppPalette.darkBorder
        : AppPalette.lightBorder;
    final accent =
        theme.brightness == Brightness.dark ? AppPalette.darkAccent : AppPalette.lightAccent;

    final maxY = _maxY(series);
    final actualSpots = <FlSpot>[];
    for (final p in series.points) {
      if (p.actual == null) break;
      actualSpots.add(FlSpot(p.day.toDouble(), p.actual!));
    }
    final budgetSpots = series.points
        .map((p) => FlSpot(p.day.toDouble(), p.budget))
        .toList();
    final histSpots = series.points
        .map((p) => FlSpot(p.day.toDouble(), p.historicalAvg))
        .toList();

    final lastDay = series.points.length;

    return SizedBox(
      height: 240,
      child: LineChart(
        LineChartData(
          minX: 1,
          maxX: lastDay.toDouble(),
          minY: 0,
          maxY: maxY,
          gridData: FlGridData(
            show: true,
            drawVerticalLine: false,
            horizontalInterval: maxY <= 0 ? 1 : maxY / 4,
            getDrawingHorizontalLine: (_) =>
                FlLine(color: border, strokeWidth: 1, dashArray: const [4, 4]),
          ),
          borderData: FlBorderData(show: false),
          titlesData: FlTitlesData(
            leftTitles: AxisTitles(
              sideTitles: SideTitles(
                showTitles: true,
                reservedSize: 44,
                interval: maxY <= 0 ? 1 : maxY / 4,
                getTitlesWidget: (value, _) => Padding(
                  padding: const EdgeInsets.only(right: 6),
                  child: Text(
                    _shortMoney(value),
                    style: theme.textTheme.labelSmall?.copyWith(color: muted),
                  ),
                ),
              ),
            ),
            rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
            topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
            bottomTitles: AxisTitles(
              sideTitles: SideTitles(
                showTitles: true,
                interval: 5,
                getTitlesWidget: (value, _) => Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text(
                    value.toInt().toString(),
                    style: theme.textTheme.labelSmall?.copyWith(color: muted),
                  ),
                ),
              ),
            ),
          ),
          lineTouchData: LineTouchData(
            touchTooltipData: LineTouchTooltipData(
              getTooltipColor: (_) => theme.colorScheme.surface,
              tooltipBorder: BorderSide(color: border),
              tooltipPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
              getTooltipItems: (spots) {
                return spots.map((s) {
                  final name = _seriesName(s.barIndex);
                  return LineTooltipItem(
                    '$name: ${formatUsd(s.y)}',
                    theme.textTheme.bodySmall!.copyWith(color: theme.colorScheme.onSurface),
                  );
                }).toList();
              },
            ),
          ),
          lineBarsData: [
            // 0: Historical avg
            LineChartBarData(
              spots: histSpots,
              isCurved: true,
              color: muted,
              barWidth: 1.5,
              dotData: const FlDotData(show: false),
            ),
            // 1: Budget straight line
            LineChartBarData(
              spots: budgetSpots,
              isCurved: false,
              color: AppPalette.positive,
              barWidth: 1.5,
              dashArray: const [6, 4],
              dotData: const FlDotData(show: false),
            ),
            // 2: Actual MTD
            LineChartBarData(
              spots: actualSpots,
              isCurved: true,
              color: accent,
              barWidth: 2.5,
              dotData: const FlDotData(show: false),
              belowBarData: BarAreaData(
                show: true,
                color: accent.withValues(alpha: 0.08),
              ),
            ),
          ],
        ),
      ),
    );
  }

  static String _seriesName(int idx) {
    switch (idx) {
      case 0:
        return 'Avg';
      case 1:
        return 'Budget';
      case 2:
        return 'Actual';
      default:
        return '?';
    }
  }

  double _maxY(SpendSeries series) {
    double m = 0;
    for (final p in series.points) {
      m = [m, p.actual ?? 0, p.budget, p.historicalAvg].reduce((a, b) => a > b ? a : b);
    }
    if (m == 0) return 100;
    // Pad so the line doesn't kiss the top edge.
    return m * 1.15;
  }

  String _shortMoney(num v) {
    if (v >= 1000) return '\$${(v / 1000).toStringAsFixed(1)}k';
    return '\$${v.toInt()}';
  }
}

class ChartLegend extends StatelessWidget {
  const ChartLegend({super.key, required this.items});

  final List<(Color, String)> items;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Wrap(
      spacing: 14,
      runSpacing: 6,
      children: items.map((it) {
        return Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 12,
              height: 3,
              decoration: BoxDecoration(
                color: it.$1,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            const SizedBox(width: 6),
            Text(it.$2, style: theme.textTheme.labelSmall),
          ],
        );
      }).toList(),
    );
  }
}
