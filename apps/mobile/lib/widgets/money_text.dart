import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../theme.dart';

final NumberFormat _bigFmt =
    NumberFormat.currency(locale: 'en_US', symbol: r'$', decimalDigits: 0);
final NumberFormat _smallFmt =
    NumberFormat.currency(locale: 'en_US', symbol: r'$', decimalDigits: 2);

String formatUsd(num value, {bool sign = false}) {
  final abs = value.abs();
  final fmt = abs >= 1000 ? _bigFmt : _smallFmt;
  final s = fmt.format(abs);
  if (value < 0) return '−$s'; // proper minus
  if (sign && value > 0) return '+$s';
  return s;
}

class MoneyText extends StatelessWidget {
  const MoneyText(
    this.amount, {
    super.key,
    this.style,
    this.sign = false,
    this.colorize = false,
    this.expense = false,
  });

  final num amount;
  final TextStyle? style;

  /// Show explicit '+' on positive values.
  final bool sign;

  /// Color positive green, negative red. Skip if false.
  final bool colorize;

  /// Treat the number as a spend amount (always positive in source, but should
  /// render in negative color). Used for category bars / monthly totals.
  final bool expense;

  @override
  Widget build(BuildContext context) {
    final txt = formatUsd(amount, sign: sign);
    Color? color;
    if (expense) {
      color = AppPalette.negative;
    } else if (colorize) {
      if (amount > 0) color = AppPalette.positive;
      if (amount < 0) color = AppPalette.negative;
    }
    final base = style ?? Theme.of(context).textTheme.bodyMedium!;
    return Text(
      txt,
      style: base.copyWith(
        color: color ?? base.color,
        fontFeatures: const [FontFeature.tabularFigures()],
      ),
    );
  }
}
