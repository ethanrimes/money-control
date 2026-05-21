import 'package:flutter/material.dart';

import '../analytics/analytics.dart';
import '../theme.dart';
import 'money_text.dart';

/// Horizontal bar per category showing absolute spend this month.
/// A small vertical tick on each bar marks the trailing 6-month average so
/// you can see at a glance whether current spend is over/under average.
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

    // Scale every bar to the max of (current, avg) across visible rows so the
    // chart is comparable.
    final scale = visible.fold<double>(
      0,
      (m, b) => [m, b.currentSpend, b.historicalAverage]
          .reduce((a, c) => a > c ? a : c),
    );
    if (scale == 0) {
      return SizedBox(
        height: 80,
        child: Center(
          child: Text('No data', style: theme.textTheme.bodySmall),
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final b in visible) ...[
          _CategoryRow(bar: b, scale: scale, accent: accent, muted: muted),
          const SizedBox(height: 12),
        ],
      ],
    );
  }
}

class _CategoryRow extends StatelessWidget {
  const _CategoryRow({
    required this.bar,
    required this.scale,
    required this.accent,
    required this.muted,
  });

  final CategoryBar bar;
  final double scale;
  final Color accent;
  final Color muted;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final over = bar.currentSpend > bar.historicalAverage && bar.historicalAverage > 0;
    final barColor = over ? AppPalette.negative : accent;
    final currentFrac = (bar.currentSpend / scale).clamp(0.0, 1.0);
    final avgFrac = (bar.historicalAverage / scale).clamp(0.0, 1.0);

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
            const SizedBox(width: 10),
            Text(
              'avg ${formatUsd(bar.historicalAverage)}',
              style: theme.textTheme.labelSmall?.copyWith(
                color: AppPalette.warning,
              ),
            ),
          ],
        ),
        const SizedBox(height: 6),
        LayoutBuilder(
          builder: (ctx, c) {
            final w = c.maxWidth;
            return SizedBox(
              height: 18,
              child: Stack(
                clipBehavior: Clip.none,
                children: [
                  Positioned.fill(
                    child: Container(
                      decoration: BoxDecoration(
                        color: muted.withValues(alpha: 0.18),
                        borderRadius: BorderRadius.circular(4),
                      ),
                    ),
                  ),
                  // Current-spend bar
                  Positioned(
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: w * currentFrac,
                    child: Container(
                      decoration: BoxDecoration(
                        color: barColor,
                        borderRadius: BorderRadius.circular(4),
                      ),
                    ),
                  ),
                  // Avg tick marker (vertical line at avg position)
                  if (bar.historicalAverage > 0)
                    Positioned(
                      left: (w * avgFrac) - 1.5,
                      top: -2,
                      bottom: -2,
                      child: Container(
                        width: 3,
                        decoration: BoxDecoration(
                          color: AppPalette.warning,
                          borderRadius: BorderRadius.circular(2),
                        ),
                      ),
                    ),
                ],
              ),
            );
          },
        ),
      ],
    );
  }
}
