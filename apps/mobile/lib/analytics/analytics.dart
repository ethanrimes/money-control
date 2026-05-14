// Client-side analytics. Direct port of the aggregation logic in
// apps/server/src/routes/summary.ts and packages/core/src/budget.ts, so the
// iOS dashboard shows the same numbers as the web app.
//
// Inputs are the raw rows from MoneyControlRepo. Everything is pure — no
// network, no I/O — so these can run on every refresh without thrashing.

import '../data/models.dart';

// ---------------------------------------------------------------------------
// Real-income / real-spend predicates (mirror packages/core/src/budget.ts).
//
// "Real income" excludes uncategorized positives + transfer-flagged inflows
// (Venmo from a friend, internal moves between accounts).
//
// "Real spend" is negative cashflow that ISN'T a transfer and isn't an
// income refund-as-negative.
// ---------------------------------------------------------------------------
bool isRealIncome(AppTransaction t) {
  if (t.amount <= 0) return false;
  if (t.categoryType != CategoryType.income) return false;
  final sub = (t.subcategoryName ?? '').toLowerCase();
  if (sub.contains('transfer')) return false;
  return true;
}

bool isRealSpend(AppTransaction t) {
  if (t.amount >= 0) return false;
  if (t.categoryType == CategoryType.income) return false;
  if (t.categoryType == CategoryType.transfer) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

int daysInMonth(int year, int month1to12) {
  // Day 0 of next month == last day of this month.
  return DateTime(year, month1to12 + 1, 0).day;
}

String formatMonthKey(DateTime d) =>
    '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}';

String _monthKey(int year, int month1to12) =>
    '${year.toString().padLeft(4, '0')}-${month1to12.toString().padLeft(2, '0')}';

// ---------------------------------------------------------------------------
// Net cash
// ---------------------------------------------------------------------------

class NetCash {
  NetCash({
    required this.totalDepository,
    required this.totalCredit,
    required this.netCash,
  });

  final double totalDepository;
  final double totalCredit;
  final double netCash;
}

NetCash computeNetCash(List<Account> accounts) {
  double dep = 0;
  double cred = 0;
  for (final a in accounts) {
    final b = a.latestBalance ?? 0;
    if (a.type == AccountType.depository) {
      dep += b;
    } else {
      cred += b;
    }
  }
  return NetCash(
    totalDepository: dep,
    totalCredit: cred,
    netCash: dep - cred,
  );
}

// ---------------------------------------------------------------------------
// Accounts grouped by enrollment (Linked institutions card)
// ---------------------------------------------------------------------------

enum AccountGroupKind { teller, plaid, manual, seeded }

class AccountGroup {
  AccountGroup({
    required this.kind,
    required this.institutionName,
    required this.accounts,
  });

  final AccountGroupKind kind;
  final String institutionName;
  final List<Account> accounts;

  double get netSigned =>
      accounts.fold(0.0, (s, a) => s + a.signedBalance);
}

List<AccountGroup> groupAccounts(List<Account> accounts) {
  // We can't enumerate teller_enrollments / plaid_items from inside the app
  // without an extra fetch, so we group by the enrollment id directly. Each
  // unique id becomes a group; orphans split into manual vs seeded.
  final byTellerEn = <int, List<Account>>{};
  final byPlaidIt = <int, List<Account>>{};
  final manual = <String, List<Account>>{};
  final seeded = <Account>[];

  for (final a in accounts) {
    if (a.tellerEnrollmentId != null) {
      (byTellerEn[a.tellerEnrollmentId!] ??= <Account>[]).add(a);
    } else if (a.plaidItemId != null) {
      (byPlaidIt[a.plaidItemId!] ??= <Account>[]).add(a);
    } else if (a.isSeeded) {
      seeded.add(a);
    } else {
      final inst = a.institution ?? 'Manual';
      (manual[inst] ??= <Account>[]).add(a);
    }
  }

  final groups = <AccountGroup>[];
  for (final entry in byTellerEn.entries) {
    final inst = entry.value.first.institution ?? 'Teller institution';
    groups.add(AccountGroup(
      kind: AccountGroupKind.teller,
      institutionName: inst,
      accounts: entry.value,
    ));
  }
  for (final entry in byPlaidIt.entries) {
    final inst = entry.value.first.institution ?? 'Plaid institution';
    groups.add(AccountGroup(
      kind: AccountGroupKind.plaid,
      institutionName: inst,
      accounts: entry.value,
    ));
  }
  for (final entry in manual.entries) {
    groups.add(AccountGroup(
      kind: AccountGroupKind.manual,
      institutionName: entry.key,
      accounts: entry.value,
    ));
  }
  if (seeded.isNotEmpty) {
    // Match the web UI: hide the seeded group from the visible list by default.
    // We still return it so the caller can show a debug toggle if desired.
    groups.add(AccountGroup(
      kind: AccountGroupKind.seeded,
      institutionName: 'Unlinked accounts',
      accounts: seeded,
    ));
  }
  groups.sort((a, b) => a.institutionName.toLowerCase().compareTo(b.institutionName.toLowerCase()));
  return groups;
}

// ---------------------------------------------------------------------------
// MTD stats
// ---------------------------------------------------------------------------

class MtdStats {
  MtdStats({
    required this.mtdSpend,
    required this.mtdIncome,
    required this.mtdTransactionCount,
  });

  final double mtdSpend;
  final double mtdIncome;
  final int mtdTransactionCount;
}

MtdStats computeMtdStats(List<AppTransaction> txns, {DateTime? now}) {
  now ??= DateTime.now();
  final key = _monthKey(now.year, now.month);
  double spend = 0;
  double income = 0;
  int count = 0;
  for (final t in txns) {
    if (t.monthKey != key) continue;
    count++;
    if (isRealSpend(t)) {
      spend += -t.amount;
    } else if (isRealIncome(t)) {
      income += t.amount;
    }
  }
  return MtdStats(
    mtdSpend: spend,
    mtdIncome: income,
    mtdTransactionCount: count,
  );
}

// ---------------------------------------------------------------------------
// Spend series: actual cumulative vs budget straight-line vs historical avg
// ---------------------------------------------------------------------------

class SpendPoint {
  SpendPoint({
    required this.day,
    required this.actual,
    required this.budget,
    required this.historicalAvg,
  });

  final int day;
  final double? actual;
  final double budget;
  final double historicalAvg;
}

class SpendSeries {
  SpendSeries({
    required this.month,
    required this.monthlyBudget,
    required this.trailingMonthlyIncome,
    required this.trailingMonthlySpend,
    required this.monthlySavingsTarget,
    required this.monthsObserved,
    required this.points,
  });

  final String month;
  final double monthlyBudget;
  final double trailingMonthlyIncome;
  final double trailingMonthlySpend;
  final double monthlySavingsTarget;
  final int monthsObserved;
  final List<SpendPoint> points;

  double get spentSoFar {
    double last = 0;
    for (final p in points) {
      if (p.actual != null) last = p.actual!;
    }
    return last;
  }
}

SpendSeries computeSpendSeries({
  required List<AppTransaction> all,
  required int year,
  required int month1to12,
  required double monthlySavingsTarget,
  int historyMonths = 6,
  DateTime? now,
}) {
  now ??= DateTime.now();
  final totalDays = daysInMonth(year, month1to12);
  final todayDay = (now.year == year && now.month == month1to12)
      ? now.day
      : totalDays;
  final targetKey = _monthKey(year, month1to12);

  // History window: previous `historyMonths` calendar months.
  final histKeys = <String>{};
  for (var k = historyMonths; k >= 1; k--) {
    final d = DateTime(year, month1to12 - k, 1);
    histKeys.add(_monthKey(d.year, d.month));
  }

  // Per-month income & spend totals in the history window.
  final incomeByMonth = <String, double>{};
  final spendByMonth = <String, double>{};
  // Per-month per-day spend, used to build the historical-avg cumulative line.
  final dailySpendByMonth = <String, List<double>>{};

  for (final t in all) {
    if (!histKeys.contains(t.monthKey)) continue;
    if (isRealIncome(t)) {
      incomeByMonth[t.monthKey] = (incomeByMonth[t.monthKey] ?? 0) + t.amount;
    }
    if (isRealSpend(t)) {
      spendByMonth[t.monthKey] = (spendByMonth[t.monthKey] ?? 0) + -t.amount;
      final arr = dailySpendByMonth.putIfAbsent(
          t.monthKey, () => List<double>.filled(31, 0));
      final di = (t.day - 1).clamp(0, 30);
      arr[di] = arr[di] + -t.amount;
    }
  }

  // Trailing monthly income — average over months that actually had income.
  final incomeMonths = incomeByMonth.keys.toList();
  final monthsObserved = incomeMonths.length;
  final incomeTotal = incomeMonths.fold<double>(
      0, (s, k) => s + (incomeByMonth[k] ?? 0));
  final trailingMonthlyIncome =
      monthsObserved > 0 ? incomeTotal / monthsObserved : 0.0;

  final monthlyBudget =
      (trailingMonthlyIncome - monthlySavingsTarget).clamp(0, double.infinity);

  // Trailing monthly spend — average over the same month set so the user
  // can compare to budget.
  final trailingSpendTotal = spendByMonth.values
      .fold<double>(0, (s, v) => s + v);
  final trailingMonthlySpend = monthsObserved > 0
      ? trailingSpendTotal / monthsObserved
      : 0.0;

  // Historical daily cumulative: average across history months.
  // 1) Cumulate per month.
  for (final arr in dailySpendByMonth.values) {
    for (var i = 1; i < arr.length; i++) {
      arr[i] = arr[i] + arr[i - 1];
    }
  }
  // 2) Average across months.
  final histAvg = List<double>.filled(totalDays, 0);
  if (dailySpendByMonth.isNotEmpty) {
    for (var d = 0; d < totalDays; d++) {
      double s = 0;
      for (final arr in dailySpendByMonth.values) {
        s += arr[d];
      }
      histAvg[d] = s / dailySpendByMonth.length;
    }
  }

  // Current month: cumulative actual spend per day.
  final dailyOutflow = List<double>.filled(totalDays + 1, 0);
  for (final t in all) {
    if (t.monthKey != targetKey) continue;
    if (!isRealSpend(t)) continue;
    final d = t.day;
    if (d < 1 || d > totalDays) continue;
    dailyOutflow[d] = dailyOutflow[d] + -t.amount;
  }
  final points = <SpendPoint>[];
  double cum = 0;
  for (var day = 1; day <= totalDays; day++) {
    cum += dailyOutflow[day];
    points.add(SpendPoint(
      day: day,
      actual: day <= todayDay ? cum : null,
      budget: (monthlyBudget * day) / totalDays,
      historicalAvg: histAvg[day - 1],
    ));
  }

  return SpendSeries(
    month: targetKey,
    monthlyBudget: monthlyBudget.toDouble(),
    trailingMonthlyIncome: trailingMonthlyIncome.toDouble(),
    trailingMonthlySpend: trailingMonthlySpend.toDouble(),
    monthlySavingsTarget: monthlySavingsTarget,
    monthsObserved: monthsObserved,
    points: points,
  );
}

// ---------------------------------------------------------------------------
// By-category: current month spend vs trailing average
// ---------------------------------------------------------------------------

class CategoryBar {
  CategoryBar({
    required this.categoryId,
    required this.categoryName,
    required this.currentSpend,
    required this.historicalAverage,
    required this.transactionCount,
  });

  final int? categoryId;
  final String categoryName;
  final double currentSpend;
  final double historicalAverage;
  final int transactionCount;
}

List<CategoryBar> computeByCategory({
  required List<AppTransaction> all,
  required int year,
  required int month1to12,
  int historyMonths = 6,
}) {
  final targetKey = _monthKey(year, month1to12);
  final histKeys = <String>{};
  for (var k = historyMonths; k >= 1; k--) {
    final d = DateTime(year, month1to12 - k, 1);
    histKeys.add(_monthKey(d.year, d.month));
  }

  final monthByCat = <int?, _CatAgg>{};
  final histByCat = <int?, double>{};
  final monthsSeen = <String>{};

  for (final t in all) {
    if (!isRealSpend(t)) continue;
    if (t.monthKey == targetKey) {
      final agg = monthByCat[t.categoryId] ??
          _CatAgg(name: t.categoryName ?? 'Uncategorized');
      agg.spend += -t.amount;
      agg.count += 1;
      monthByCat[t.categoryId] = agg;
    } else if (histKeys.contains(t.monthKey)) {
      monthsSeen.add(t.monthKey);
      histByCat[t.categoryId] = (histByCat[t.categoryId] ?? 0) + -t.amount;
    }
  }

  final divisor = monthsSeen.isEmpty ? 1 : monthsSeen.length;
  final out = monthByCat.entries
      .map((e) => CategoryBar(
            categoryId: e.key,
            categoryName: e.value.name,
            currentSpend: e.value.spend,
            historicalAverage: (histByCat[e.key] ?? 0) / divisor,
            transactionCount: e.value.count,
          ))
      .toList()
    ..sort((a, b) => b.currentSpend.compareTo(a.currentSpend));
  return out;
}

class _CatAgg {
  _CatAgg({required this.name});
  String name;
  double spend = 0;
  int count = 0;
}

// ---------------------------------------------------------------------------
// Monthly detail (income or spend)
// ---------------------------------------------------------------------------

enum MonthlyDetailMode { income, spend }

class MonthlyTransaction {
  MonthlyTransaction({
    required this.id,
    required this.date,
    required this.description,
    required this.amount,
    required this.accountName,
    required this.categoryName,
    required this.subcategoryName,
  });

  final int id;
  final String date;
  final String description;
  final double amount;
  final String? accountName;
  final String? categoryName;
  final String? subcategoryName;
}

class MonthSection {
  MonthSection({
    required this.month,
    required this.isComplete,
    required this.total,
    required this.transactions,
  });

  final String month;
  final bool isComplete;
  final double total;
  final List<MonthlyTransaction> transactions;
}

class MonthlyDetail {
  MonthlyDetail({
    required this.currentMonth,
    required this.completedMonthCount,
    required this.totalOverCompletedMonths,
    required this.averageOverCompletedMonths,
    required this.months,
  });

  final String currentMonth;
  final int completedMonthCount;
  final double totalOverCompletedMonths;
  final double averageOverCompletedMonths;
  final List<MonthSection> months;
}

MonthlyDetail computeMonthlyDetail({
  required List<AppTransaction> all,
  required MonthlyDetailMode mode,
  int? throughDay,
  int? topCategoryId,
  int? subcategoryId,
  DateTime? now,
}) {
  now ??= DateTime.now();
  final currentMonth = _monthKey(now.year, now.month);

  final byMonth = <String, List<MonthlyTransaction>>{};
  for (final t in all) {
    final keep = mode == MonthlyDetailMode.income ? isRealIncome(t) : isRealSpend(t);
    if (!keep) continue;
    if (throughDay != null && t.day > throughDay) continue;
    if (topCategoryId != null && t.categoryId != topCategoryId) continue;
    if (subcategoryId != null && t.subcategoryId != subcategoryId) continue;
    final mt = MonthlyTransaction(
      id: t.id,
      date: t.date,
      description: t.description,
      amount: t.amount,
      accountName: t.accountName,
      categoryName: t.categoryName,
      subcategoryName: t.subcategoryName,
    );
    (byMonth[t.monthKey] ??= <MonthlyTransaction>[]).add(mt);
  }

  final keys = byMonth.keys.toList()..sort((a, b) => b.compareTo(a));
  final sections = keys.map((m) {
    final txns = byMonth[m]!..sort((a, b) => a.date.compareTo(b.date));
    final total = txns.fold<double>(0, (s, t) => s + t.amount.abs());
    return MonthSection(
      month: m,
      isComplete: m.compareTo(currentMonth) < 0,
      total: total,
      transactions: txns,
    );
  }).toList();

  final completed = sections.where((s) => s.isComplete).toList();
  final completedTotal = completed.fold<double>(0, (s, m) => s + m.total);
  final completedCount = completed.length;
  return MonthlyDetail(
    currentMonth: currentMonth,
    completedMonthCount: completedCount,
    totalOverCompletedMonths: completedTotal,
    averageOverCompletedMonths:
        completedCount > 0 ? completedTotal / completedCount : 0,
    months: sections,
  );
}
