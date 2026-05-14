import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../analytics/analytics.dart';
import '../data/dashboard_store.dart';
import '../widgets/monthly_detail_view.dart';

class BudgetPage extends StatelessWidget {
  const BudgetPage({super.key});

  @override
  Widget build(BuildContext context) {
    final store = context.watch<DashboardStore>();
    final detail = computeMonthlyDetail(
      all: store.transactions,
      mode: MonthlyDetailMode.income,
    );

    return SafeArea(
      child: CustomScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        slivers: [
          SliverAppBar.large(
            title: const Text('Budget'),
            actions: [
              IconButton(
                tooltip: 'Refresh',
                icon: const Icon(CupertinoIcons.arrow_clockwise),
                onPressed: store.loading ? null : () => store.refresh(),
              ),
            ],
          ),
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
            sliver: SliverToBoxAdapter(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: Text(
                      'Income per month from every source. The headline total excludes the in-progress month so the average reflects whole months only.',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ),
                  MonthlyDetailView(
                    detail: detail,
                    unitLabel: 'income',
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
