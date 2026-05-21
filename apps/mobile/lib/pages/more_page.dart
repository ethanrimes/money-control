import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:provider/provider.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:url_launcher/url_launcher.dart';

import '../data/dashboard_store.dart';
import '../theme.dart';
import '../widgets/section_card.dart';
import 'accounts_page.dart';
import 'categories_page.dart';

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
                _NavCard(
                  icon: CupertinoIcons.creditcard,
                  title: 'Accounts',
                  subtitle:
                      'View linked banks, set manual balances, disconnect institutions.',
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute(builder: (_) => const AccountsPage()),
                  ),
                ),
                const SizedBox(height: 16),
                _NavCard(
                  icon: CupertinoIcons.tag,
                  title: 'Categories',
                  subtitle:
                      'Add, rename, change type, or delete categories and subcategories.',
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute(builder: (_) => const CategoriesPage()),
                  ),
                ),
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

class _NavCard extends StatelessWidget {
  const _NavCard({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return SectionCard(
      title: title,
      subtitle: subtitle,
      trailing: const Icon(Icons.chevron_right),
      onTap: onTap,
      child: const SizedBox.shrink(),
    );
  }
}

class _BudgetSettingsCard extends StatelessWidget {
  const _BudgetSettingsCard({required this.store});

  final DashboardStore store;

  @override
  Widget build(BuildContext context) {
    final ctl = TextEditingController(
        text: (store.monthlySavingsTarget).toStringAsFixed(0));
    return SectionCard(
      title: 'Monthly savings target',
      subtitle:
          'Used to compute your monthly budget: budget = trailing-month income − this target.',
      child: Row(
        children: [
          Expanded(
            child: TextField(
              controller: ctl,
              keyboardType:
                  const TextInputType.numberWithOptions(decimal: true),
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
        final version =
            info == null ? '—' : '${info.version} (${info.buildNumber})';
        return SectionCard(
          title: 'About',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Version $version',
                  style: Theme.of(context).textTheme.bodyMedium),
              const SizedBox(height: 4),
              InkWell(
                onTap: () => launchUrl(
                  Uri.parse('https://github.com/ethanrimes/money-control'),
                  mode: LaunchMode.externalApplication,
                ),
                child: Text(
                  'Personal-finance dashboard. Source on GitHub.',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}
