import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../data/dashboard_store.dart';
import '../data/models.dart';
import '../theme.dart';
import '../widgets/money_text.dart';
import '../widgets/section_card.dart';

/// Pushed from MorePage. Lists every account — manual, Teller, Plaid — and
/// lets the user (a) override the latest balance for any account and
/// (b) disconnect a linked institution group, mirroring the web app's
/// LinkedAccountsCard.
class AccountsPage extends StatelessWidget {
  const AccountsPage({super.key});

  @override
  Widget build(BuildContext context) {
    final store = context.watch<DashboardStore>();
    final groups = _groupByInstitution(store.accounts);

    return Scaffold(
      appBar: AppBar(title: const Text('Accounts')),
      body: SafeArea(
        child: groups.isEmpty
            ? const EmptyState(
                icon: CupertinoIcons.creditcard,
                title: 'No accounts yet',
                message: 'Link a bank or add a manual account to get started.',
              )
            : ListView(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
                children: [
                  for (final g in groups) ...[
                    _InstitutionGroup(group: g, store: store),
                    const SizedBox(height: 16),
                  ],
                  _AddManualAccountCard(store: store),
                  const SizedBox(height: 16),
                  _LinkExternalCard(),
                ],
              ),
      ),
    );
  }

  static List<_Group> _groupByInstitution(List<Account> accounts) {
    final manual = <Account>[];
    final byInst = <_GroupKey, List<Account>>{};
    for (final a in accounts) {
      if (a.isOrphan) {
        manual.add(a);
        continue;
      }
      final key = _GroupKey(
        tellerEnrollmentId: a.tellerEnrollmentId,
        plaidItemId: a.plaidItemId,
        institution: a.institution ?? '(unknown)',
      );
      (byInst[key] ??= <Account>[]).add(a);
    }
    final out = <_Group>[];
    byInst.forEach((key, accts) {
      accts.sort((a, b) => a.name.compareTo(b.name));
      out.add(_Group(key: key, accounts: accts));
    });
    out.sort((a, b) => a.key.institution.compareTo(b.key.institution));
    if (manual.isNotEmpty) {
      manual.sort((a, b) => a.name.compareTo(b.name));
      out.add(_Group(
        key: const _GroupKey(institution: 'Manual accounts'),
        accounts: manual,
      ));
    }
    return out;
  }
}

class _GroupKey {
  const _GroupKey({
    this.tellerEnrollmentId,
    this.plaidItemId,
    required this.institution,
  });
  final int? tellerEnrollmentId;
  final int? plaidItemId;
  final String institution;

  bool get isManual => tellerEnrollmentId == null && plaidItemId == null;

  @override
  bool operator ==(Object other) =>
      other is _GroupKey &&
      other.tellerEnrollmentId == tellerEnrollmentId &&
      other.plaidItemId == plaidItemId &&
      other.institution == institution;

  @override
  int get hashCode => Object.hash(tellerEnrollmentId, plaidItemId, institution);
}

class _Group {
  _Group({required this.key, required this.accounts});
  final _GroupKey key;
  final List<Account> accounts;
}

class _InstitutionGroup extends StatelessWidget {
  const _InstitutionGroup({required this.group, required this.store});

  final _Group group;
  final DashboardStore store;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final total = group.accounts.fold<double>(0, (s, a) => s + a.signedBalance);
    return SectionCard(
      title: group.key.institution,
      subtitle: '${group.accounts.length} account${group.accounts.length == 1 ? '' : 's'}',
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          MoneyText(total, colorize: true, sign: false, style: theme.textTheme.titleSmall),
          if (!group.key.isManual)
            IconButton(
              tooltip: 'Manage',
              icon: const Icon(Icons.more_horiz),
              onPressed: () => _showInstitutionMenu(context),
            ),
        ],
      ),
      child: Column(
        children: [
          for (final a in group.accounts) _AccountRow(account: a, store: store),
        ],
      ),
    );
  }

  Future<void> _showInstitutionMenu(BuildContext context) async {
    final action = await showModalBottomSheet<String>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Wrap(
          children: [
            ListTile(
              leading: const Icon(Icons.link_off, color: Colors.red),
              title: const Text('Disconnect institution',
                  style: TextStyle(color: Colors.red)),
              subtitle: const Text(
                  'Removes this institution\'s accounts and their transactions.'),
              onTap: () => Navigator.of(ctx).pop('disconnect'),
            ),
            ListTile(
              leading: const Icon(Icons.close),
              title: const Text('Cancel'),
              onTap: () => Navigator.of(ctx).pop(),
            ),
          ],
        ),
      ),
    );
    if (action != 'disconnect') return;
    if (!context.mounted) return;
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Disconnect ${group.key.institution}?'),
        content: const Text(
            'All accounts and transactions from this institution will be removed. This cannot be undone.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(ctx).pop(false),
              child: const Text('Cancel')),
          FilledButton.tonal(
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(ctx).colorScheme.errorContainer,
              foregroundColor: Theme.of(ctx).colorScheme.onErrorContainer,
            ),
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Disconnect'),
          ),
        ],
      ),
    );
    if (confirm != true) return;
    try {
      if (group.key.tellerEnrollmentId != null) {
        await store.repo.disconnectTellerEnrollment(group.key.tellerEnrollmentId!);
      } else if (group.key.plaidItemId != null) {
        await store.repo.disconnectPlaidItem(group.key.plaidItemId!);
      }
      await store.refresh();
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Disconnected ${group.key.institution}')),
        );
      }
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Disconnect failed: $e')),
        );
      }
    }
  }
}

class _AccountRow extends StatelessWidget {
  const _AccountRow({required this.account, required this.store});

  final Account account;
  final DashboardStore store;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final bal = account.latestBalance;
    final asOf = account.latestBalanceDate;
    return InkWell(
      onTap: () => _editBalance(context),
      borderRadius: BorderRadius.circular(8),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 10),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(account.name),
                  Text(
                    [
                      account.type.name,
                      if (account.lastFour != null) '••${account.lastFour}',
                      if (asOf != null) 'as of $asOf',
                    ].join(' · '),
                    style: theme.textTheme.bodySmall,
                  ),
                ],
              ),
            ),
            MoneyText(
              account.signedBalance,
              colorize: true,
              sign: false,
              style: theme.textTheme.bodyMedium,
            ),
            const SizedBox(width: 8),
            Icon(Icons.edit_outlined,
                size: 18, color: theme.textTheme.bodySmall?.color),
          ],
        ),
      ),
    );
  }

  Future<void> _editBalance(BuildContext context) async {
    final ctl = TextEditingController(
        text: (account.latestBalance ?? 0).toStringAsFixed(2));
    final result = await showDialog<double>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Set balance — ${account.name}'),
        content: TextField(
          controller: ctl,
          keyboardType: const TextInputType.numberWithOptions(decimal: true, signed: true),
          decoration: const InputDecoration(
            prefixText: r'$ ',
            labelText: 'Current balance',
            helperText: 'For credit cards, enter the outstanding balance as a positive number.',
          ),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(ctx).pop(),
              child: const Text('Cancel')),
          FilledButton(
            onPressed: () {
              final v = double.tryParse(ctl.text);
              if (v == null) return;
              Navigator.of(ctx).pop(v);
            },
            child: const Text('Save'),
          ),
        ],
      ),
    );
    if (result == null) return;
    try {
      await store.repo.updateAccountBalance(account.id, result);
      await store.refresh();
      if (context.mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('Balance saved')));
      }
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Save failed: $e')),
        );
      }
    }
  }
}

class _AddManualAccountCard extends StatelessWidget {
  const _AddManualAccountCard({required this.store});

  final DashboardStore store;

  @override
  Widget build(BuildContext context) {
    return SectionCard(
      title: 'Add manual account',
      subtitle:
          'Track a balance for an account that isn\'t connected via Teller or Plaid.',
      child: OutlinedButton.icon(
        icon: const Icon(Icons.add),
        label: const Text('New manual account'),
        onPressed: () => _showAddSheet(context),
      ),
    );
  }

  Future<void> _showAddSheet(BuildContext context) async {
    final nameCtl = TextEditingController();
    final balCtl = TextEditingController(text: '0');
    AccountType type = AccountType.depository;
    final result = await showModalBottomSheet<_NewManual?>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) {
        return StatefulBuilder(
          builder: (ctx, setState) {
            final padding = MediaQuery.of(ctx).viewInsets;
            return Padding(
              padding: padding,
              child: SafeArea(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text('New manual account',
                          style: Theme.of(ctx).textTheme.titleLarge),
                      const SizedBox(height: 12),
                      TextField(
                        controller: nameCtl,
                        decoration: const InputDecoration(labelText: 'Name'),
                      ),
                      const SizedBox(height: 12),
                      SegmentedButton<AccountType>(
                        segments: const [
                          ButtonSegment(
                              value: AccountType.depository,
                              label: Text('Depository')),
                          ButtonSegment(
                              value: AccountType.credit,
                              label: Text('Credit')),
                        ],
                        selected: {type},
                        onSelectionChanged: (s) =>
                            setState(() => type = s.first),
                      ),
                      const SizedBox(height: 12),
                      TextField(
                        controller: balCtl,
                        keyboardType: const TextInputType.numberWithOptions(
                            decimal: true, signed: true),
                        decoration: const InputDecoration(
                          labelText: 'Starting balance',
                          prefixText: r'$ ',
                        ),
                      ),
                      const SizedBox(height: 16),
                      FilledButton(
                        onPressed: () {
                          final name = nameCtl.text.trim();
                          if (name.isEmpty) return;
                          final bal = double.tryParse(balCtl.text) ?? 0;
                          Navigator.of(ctx)
                              .pop(_NewManual(name: name, type: type, balance: bal));
                        },
                        child: const Text('Create'),
                      ),
                    ],
                  ),
                ),
              ),
            );
          },
        );
      },
    );
    if (result == null) return;
    try {
      final created = await store.repo
          .createManualAccount(name: result.name, type: result.type);
      await store.repo.updateAccountBalance(created.id, result.balance);
      await store.refresh();
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Created ${created.name}')),
        );
      }
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Create failed: $e')),
        );
      }
    }
  }
}

class _NewManual {
  _NewManual({required this.name, required this.type, required this.balance});
  final String name;
  final AccountType type;
  final double balance;
}

class _LinkExternalCard extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return SectionCard(
      title: 'Link a bank',
      subtitle:
          'Teller and Plaid setup happens in the web app. Newly linked accounts and transactions appear here automatically after the next refresh.',
      child: OutlinedButton.icon(
        icon: const Icon(Icons.open_in_new),
        label: const Text('Open web app'),
        onPressed: () async {
          final uri = Uri.parse('https://money-control-web.vercel.app/');
          if (!await launchUrl(uri, mode: LaunchMode.externalApplication)) {
            if (context.mounted) {
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('Could not open browser')),
              );
            }
          }
        },
      ),
    );
  }
}
