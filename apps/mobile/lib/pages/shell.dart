import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../data/dashboard_store.dart';
import 'budget_page.dart';
import 'dashboard_page.dart';
import 'historical_avg_page.dart';
import 'more_page.dart';
import 'transactions_page.dart';

class TabShell extends StatefulWidget {
  const TabShell({super.key});

  @override
  State<TabShell> createState() => _TabShellState();
}

class _TabShellState extends State<TabShell> {
  int _index = 0;

  final _pages = const <Widget>[
    DashboardPage(),
    TransactionsPage(),
    BudgetPage(),
    HistoricalAvgPage(),
    MorePage(),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: RefreshIndicator(
        onRefresh: () => context.read<DashboardStore>().refresh(),
        child: IndexedStack(index: _index, children: _pages),
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() => _index = i),
        destinations: const [
          NavigationDestination(
              icon: Icon(CupertinoIcons.chart_pie), label: 'Dashboard'),
          NavigationDestination(
              icon: Icon(CupertinoIcons.list_bullet), label: 'Transactions'),
          NavigationDestination(
              icon: Icon(CupertinoIcons.chart_bar_alt_fill), label: 'Budget'),
          NavigationDestination(
              icon: Icon(CupertinoIcons.calendar), label: 'History'),
          NavigationDestination(
              icon: Icon(CupertinoIcons.ellipsis), label: 'More'),
        ],
      ),
    );
  }
}
