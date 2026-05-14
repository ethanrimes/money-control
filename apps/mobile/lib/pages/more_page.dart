import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:provider/provider.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../data/dashboard_store.dart';
import '../data/models.dart';
import '../theme.dart';
import '../widgets/money_text.dart';
import '../widgets/section_card.dart';

class MorePage extends StatelessWidget {
  const MorePage({super.key});

  @override
  Widget build(BuildContext context) {
    final store = context.watch<DashboardStore>();
    return SafeArea(
      child: CustomScrollView(
        slivers: [
          const SliverAppBar.large(title: Text('More')),
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
            sliver: SliverList.list(
              children: [
                _BudgetSettingsCard(store: store),
                const SizedBox(height: 16),
                _ManualAccountsCard(store: store),
                const SizedBox(height: 16),
                _CategoriesCard(store: store),
                const SizedBox(height: 16),
                _SecurityCard(),
                const SizedBox(height: 16),
                const _SignOutCard(),
                const SizedBox(height: 16),
                const _AboutCard(),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _BudgetSettingsCard extends StatelessWidget {
  const _BudgetSettingsCard({required this.store});

  final DashboardStore store;

  @override
  Widget build(BuildContext context) {
    final ctl =
        TextEditingController(text: (store.monthlySavingsTarget).toStringAsFixed(0));
    return SectionCard(
      title: 'Monthly savings target',
      subtitle:
          'Used to compute your monthly budget: budget = trailing-month income − this target.',
      child: Row(
        children: [
          Expanded(
            child: TextField(
              controller: ctl,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(
                prefixText: r'$ ',
                labelText: 'USD per month',
              ),
            ),
          ),
          const SizedBox(width: 8),
          FilledButton(
            onPressed: () async {
              final value = double.tryParse(ctl.text);
              if (value == null || value < 0) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Enter a non-negative number')),
                );
                return;
              }
              try {
                await store.repo.upsertBudget(monthlySavingsTarget: value);
                await store.refresh();
                if (context.mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Saved')),
                  );
                }
              } catch (e) {
                if (context.mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: Text('Save failed: $e')),
                  );
                }
              }
            },
            child: const Text('Save'),
          ),
        ],
      ),
    );
  }
}

class _ManualAccountsCard extends StatelessWidget {
  const _ManualAccountsCard({required this.store});

  final DashboardStore store;

  @override
  Widget build(BuildContext context) {
    final manual = store.accounts.where((a) => a.isManual).toList();
    return SectionCard(
      title: 'Manual account balances',
      subtitle:
          'Set or update balances for accounts not connected via Teller/Plaid. Web app handles the original linking.',
      child: manual.isEmpty
          ? Padding(
              padding: const EdgeInsets.symmetric(vertical: 16),
              child: Text(
                'No manual accounts. Add or link them in the web app.',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            )
          : Column(
              children: [
                for (final a in manual)
                  _ManualAccountRow(account: a, store: store),
              ],
            ),
    );
  }
}

class _ManualAccountRow extends StatefulWidget {
  const _ManualAccountRow({required this.account, required this.store});

  final Account account;
  final DashboardStore store;

  @override
  State<_ManualAccountRow> createState() => _ManualAccountRowState();
}

class _ManualAccountRowState extends State<_ManualAccountRow> {
  late final TextEditingController _ctl;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _ctl = TextEditingController(
        text: (widget.account.latestBalance ?? 0).toStringAsFixed(2));
  }

  @override
  void dispose() {
    _ctl.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final v = double.tryParse(_ctl.text);
    if (v == null) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('Invalid number')));
      return;
    }
    setState(() => _saving = true);
    try {
      await widget.store.repo.updateAccountBalance(widget.account.id, v);
      await widget.store.refresh();
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(widget.account.name),
                Text(
                  '${widget.account.type.name}${widget.account.lastFour != null ? ' · ••${widget.account.lastFour}' : ''}',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ],
            ),
          ),
          SizedBox(
            width: 96,
            child: TextField(
              controller: _ctl,
              textAlign: TextAlign.end,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(
                prefixText: r'$',
                isDense: true,
              ),
            ),
          ),
          IconButton(
            tooltip: 'Save',
            icon: _saving
                ? const SizedBox(
                    width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2.4))
                : const Icon(Icons.check),
            onPressed: _saving ? null : _save,
          ),
        ],
      ),
    );
  }
}

class _CategoriesCard extends StatelessWidget {
  const _CategoriesCard({required this.store});

  final DashboardStore store;

  @override
  Widget build(BuildContext context) {
    final tree = store.categoryTree;
    return SectionCard(
      title: 'Categories',
      subtitle:
          'Add new categories / subcategories. Renames, type changes, and deletes are easiest in the web app.',
      trailing: IconButton(
        icon: const Icon(Icons.add),
        onPressed: () async {
          final result =
              await showModalBottomSheet<({String? cat, String? sub})>(
            context: context,
            isScrollControlled: true,
            builder: (ctx) => _CategoryAddSheet(tree: tree),
          );
          if (result == null) return;
          if (result.cat == null || result.cat!.isEmpty) return;
          final existing = store.categories
              .where((c) =>
                  c.parentId == null &&
                  c.name.toLowerCase() == result.cat!.toLowerCase())
              .toList();
          AppCategory parent;
          try {
            if (existing.isNotEmpty) {
              parent = existing.first;
            } else {
              parent = await store.repo.createCategory(name: result.cat!);
            }
            if (result.sub != null && result.sub!.isNotEmpty) {
              await store.repo
                  .createCategory(name: result.sub!, parentId: parent.id);
            }
            await store.refresh();
          } catch (e) {
            if (context.mounted) {
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(content: Text('Add failed: $e')),
              );
            }
          }
        },
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final top in tree) ...[
            ListTile(
              dense: true,
              contentPadding: EdgeInsets.zero,
              title: Text(top.category.name,
                  style: const TextStyle(fontWeight: FontWeight.w600)),
              subtitle: Text(_categoryTypeLabel(top.category.type)),
            ),
            if (top.subcategories.isNotEmpty)
              for (final sub in top.subcategories)
                Padding(
                  padding: const EdgeInsets.only(left: 16),
                  child: ListTile(
                    dense: true,
                    contentPadding: EdgeInsets.zero,
                    title: Text('↳ ${sub.name}'),
                    subtitle: Text(_categoryTypeLabel(sub.type)),
                  ),
                ),
          ],
          if (tree.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 16),
              child: Text(
                'No categories yet.',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ),
        ],
      ),
    );
  }

  static String _categoryTypeLabel(CategoryType t) {
    switch (t) {
      case CategoryType.expense:
        return 'expense';
      case CategoryType.income:
        return 'income';
      case CategoryType.transfer:
        return 'transfer';
    }
  }
}

class _CategoryAddSheet extends StatefulWidget {
  const _CategoryAddSheet({required this.tree});
  final List<CategoryNode> tree;

  @override
  State<_CategoryAddSheet> createState() => _CategoryAddSheetState();
}

class _CategoryAddSheetState extends State<_CategoryAddSheet> {
  final _catCtl = TextEditingController();
  final _subCtl = TextEditingController();

  @override
  void dispose() {
    _catCtl.dispose();
    _subCtl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final padding = MediaQuery.of(context).viewInsets;
    return Padding(
      padding: padding,
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('Add category', style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 12),
              TextField(
                controller: _catCtl,
                decoration: const InputDecoration(
                  labelText: 'Category (existing or new)',
                ),
              ),
              const SizedBox(height: 8),
              TextField(
                controller: _subCtl,
                decoration: const InputDecoration(
                  labelText: 'Subcategory (optional)',
                ),
              ),
              const SizedBox(height: 16),
              FilledButton(
                onPressed: () => Navigator.of(context).pop(
                  (cat: _catCtl.text.trim(), sub: _subCtl.text.trim()),
                ),
                child: const Text('Save'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SecurityCard extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return SectionCard(
      title: 'Security',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _SecurityBullet(
            icon: CupertinoIcons.lock_shield_fill,
            title: 'Per-row tenant isolation',
            text:
                'Every database table has Row-Level Security policies that match user_id against your JWT. Other users cannot read or write your rows.',
          ),
          _SecurityBullet(
            icon: CupertinoIcons.lock_fill,
            title: 'Keychain-backed session',
            text:
                'Your Supabase session lives in the iOS Keychain (via flutter_secure_storage). It never lands on disk in plaintext.',
          ),
          _SecurityBullet(
            icon: CupertinoIcons.bolt_fill,
            title: 'PKCE auth flow',
            text:
                'Sign-in uses PKCE so even if the deep-link callback URL is intercepted, no token can be replayed without our verifier.',
          ),
          _SecurityBullet(
            icon: CupertinoIcons.shield_fill,
            title: 'HTTPS-only',
            text:
                'NSAllowsArbitraryLoads is false; all traffic to Supabase happens over TLS.',
          ),
        ],
      ),
    );
  }
}

class _SecurityBullet extends StatelessWidget {
  const _SecurityBullet({
    required this.icon,
    required this.title,
    required this.text,
  });

  final IconData icon;
  final String title;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: AppPalette.positive, size: 18),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title,
                    style: Theme.of(context)
                        .textTheme
                        .bodyMedium
                        ?.copyWith(fontWeight: FontWeight.w600)),
                const SizedBox(height: 2),
                Text(text, style: Theme.of(context).textTheme.bodySmall),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _SignOutCard extends StatelessWidget {
  const _SignOutCard();

  @override
  Widget build(BuildContext context) {
    final user = Supabase.instance.client.auth.currentUser;
    return SectionCard(
      title: 'Signed in',
      subtitle: user?.email ?? '(unknown)',
      child: OutlinedButton.icon(
        icon: const Icon(CupertinoIcons.square_arrow_right),
        style: OutlinedButton.styleFrom(foregroundColor: AppPalette.negative),
        label: const Text('Sign out'),
        onPressed: () async {
          await Supabase.instance.client.auth.signOut();
        },
      ),
    );
  }
}

class _AboutCard extends StatelessWidget {
  const _AboutCard();

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<PackageInfo>(
      future: PackageInfo.fromPlatform(),
      builder: (ctx, snap) {
        final info = snap.data;
        final version = info == null
            ? '—'
            : '${info.version} (${info.buildNumber})';
        return SectionCard(
          title: 'About',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Version $version',
                  style: Theme.of(context).textTheme.bodyMedium),
              const SizedBox(height: 4),
              Text(
                'Personal-finance dashboard. Source on GitHub.',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
          ),
        );
      },
    );
  }
}
