import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../analytics/analytics.dart';
import '../data/dashboard_store.dart';
import '../data/models.dart';
import '../widgets/monthly_detail_view.dart';
import '../widgets/section_card.dart';

class HistoricalAvgPage extends StatefulWidget {
  const HistoricalAvgPage({super.key});

  @override
  State<HistoricalAvgPage> createState() => _HistoricalAvgPageState();
}

class _HistoricalAvgPageState extends State<HistoricalAvgPage> {
  double _throughDay = 31;
  int? _topCategoryId; // null = no filter
  int? _subcategoryId; // null = no subcategory filter

  @override
  Widget build(BuildContext context) {
    final store = context.watch<DashboardStore>();
    final detail = computeMonthlyDetail(
      all: store.transactions,
      mode: MonthlyDetailMode.spend,
      throughDay: _throughDay.round(),
      topCategoryId: _topCategoryId,
      subcategoryId: _subcategoryId,
    );

    return SafeArea(
      child: CustomScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        slivers: [
          SliverAppBar.large(
            title: const Text('Historical avg'),
            actions: [
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
                title: 'Controls',
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      'Through day of month: ${_throughDay.round()}',
                      style: Theme.of(context).textTheme.bodyMedium,
                    ),
                    Slider(
                      min: 1,
                      max: 31,
                      divisions: 30,
                      value: _throughDay,
                      onChanged: (v) => setState(() => _throughDay = v),
                    ),
                    Text(
                      'Only transactions on or before day ${_throughDay.round()} of each month are counted (apples-to-apples comparison).',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                    const SizedBox(height: 12),
                    DropdownButtonFormField<String>(
                      value: _selectionKey(),
                      decoration: const InputDecoration(
                          labelText: 'Category / subcategory', isDense: true),
                      items: [
                        const DropdownMenuItem(
                            value: 'all', child: Text('Everything (all categories)')),
                        for (final top in store.categoryTree) ...[
                          DropdownMenuItem(
                            value: 'top-${top.category.id}',
                            child: Text(top.category.name),
                          ),
                          for (final sub in top.subcategories)
                            DropdownMenuItem(
                              value: 'sub-${sub.id}',
                              child: Text('  ↳ ${top.category.name} / ${sub.name}'),
                            ),
                        ],
                      ],
                      onChanged: (v) => _setSelection(v, store.categoryTree),
                    ),
                  ],
                ),
              ),
            ),
          ),
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
            sliver: SliverToBoxAdapter(
              child: MonthlyDetailView(
                detail: detail,
                unitLabel: 'spend',
                summaryMode: MonthlySummaryMode.average,
              ),
            ),
          ),
        ],
      ),
    );
  }

  String _selectionKey() {
    if (_subcategoryId != null) return 'sub-$_subcategoryId';
    if (_topCategoryId != null) return 'top-$_topCategoryId';
    return 'all';
  }

  void _setSelection(String? value, List<CategoryNode> tree) {
    if (value == null || value == 'all') {
      setState(() {
        _topCategoryId = null;
        _subcategoryId = null;
      });
      return;
    }
    if (value.startsWith('top-')) {
      setState(() {
        _topCategoryId = int.parse(value.substring(4));
        _subcategoryId = null;
      });
    } else if (value.startsWith('sub-')) {
      final id = int.parse(value.substring(4));
      int? parentId;
      for (final t in tree) {
        if (t.subcategories.any((s) => s.id == id)) {
          parentId = t.category.id;
          break;
        }
      }
      setState(() {
        _topCategoryId = parentId;
        _subcategoryId = id;
      });
    }
  }
}
