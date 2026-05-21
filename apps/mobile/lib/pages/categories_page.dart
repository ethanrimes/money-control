import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../data/dashboard_store.dart';
import '../data/models.dart';
import '../widgets/section_card.dart';

/// Pushed from MorePage. Mirrors the web app's CategoriesEditor: add / rename
/// / change type / delete with cascade-or-promote prompt, for both top-level
/// categories and their subcategories.
class CategoriesPage extends StatelessWidget {
  const CategoriesPage({super.key});

  @override
  Widget build(BuildContext context) {
    final store = context.watch<DashboardStore>();
    final tree = store.categoryTree;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Categories'),
        actions: [
          IconButton(
            tooltip: 'Add category',
            icon: const Icon(Icons.add),
            onPressed: () => _addCategory(context, store, parent: null),
          ),
        ],
      ),
      body: SafeArea(
        child: tree.isEmpty
            ? const Center(child: Text('No categories yet. Tap + to add one.'))
            : ListView(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
                children: [
                  for (final top in tree)
                    _CategoryGroupCard(node: top, store: store),
                ],
              ),
      ),
    );
  }

  static Future<void> _addCategory(
    BuildContext context,
    DashboardStore store, {
    required AppCategory? parent,
  }) async {
    final nameCtl = TextEditingController();
    CategoryType type = parent?.type ?? CategoryType.expense;
    final result = await showModalBottomSheet<_CategoryFormResult?>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => StatefulBuilder(builder: (ctx, setState) {
        return Padding(
          padding: MediaQuery.of(ctx).viewInsets,
          child: SafeArea(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                      parent == null
                          ? 'New category'
                          : 'New subcategory of ${parent.name}',
                      style: Theme.of(ctx).textTheme.titleLarge),
                  const SizedBox(height: 12),
                  TextField(
                    controller: nameCtl,
                    decoration: const InputDecoration(labelText: 'Name'),
                    autofocus: true,
                  ),
                  if (parent == null) ...[
                    const SizedBox(height: 12),
                    _TypeSelector(
                      value: type,
                      onChanged: (v) => setState(() => type = v),
                    ),
                  ],
                  const SizedBox(height: 16),
                  FilledButton(
                    onPressed: () {
                      final name = nameCtl.text.trim();
                      if (name.isEmpty) return;
                      Navigator.of(ctx).pop(_CategoryFormResult(
                        name: name,
                        type: type,
                      ));
                    },
                    child: const Text('Create'),
                  ),
                ],
              ),
            ),
          ),
        );
      }),
    );
    if (result == null) return;
    try {
      await store.repo.createCategory(
        name: result.name,
        parentId: parent?.id,
        type: parent?.type ?? result.type,
      );
      await store.refresh();
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Create failed: $e')),
        );
      }
    }
  }
}

class _CategoryGroupCard extends StatelessWidget {
  const _CategoryGroupCard({required this.node, required this.store});

  final CategoryNode node;
  final DashboardStore store;

  @override
  Widget build(BuildContext context) {
    return SectionCard(
      title: node.category.name,
      subtitle: _typeLabel(node.category.type),
      trailing: PopupMenuButton<String>(
        onSelected: (v) => _handle(context, v),
        itemBuilder: (ctx) => const [
          PopupMenuItem(value: 'add', child: Text('Add subcategory')),
          PopupMenuItem(value: 'rename', child: Text('Rename')),
          PopupMenuItem(value: 'type', child: Text('Change type')),
          PopupMenuDivider(),
          PopupMenuItem(
              value: 'delete',
              child: Text('Delete', style: TextStyle(color: Colors.red))),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (node.subcategories.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 6),
              child: Text(
                'No subcategories.',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            )
          else
            for (final sub in node.subcategories)
              _SubcategoryRow(sub: sub, parent: node.category, store: store),
        ],
      ),
    );
  }

  Future<void> _handle(BuildContext context, String action) async {
    switch (action) {
      case 'add':
        await CategoriesPage._addCategory(context, store, parent: node.category);
        break;
      case 'rename':
        await _rename(context, node.category, store);
        break;
      case 'type':
        await _changeType(context, node.category, store);
        break;
      case 'delete':
        await _delete(context, node, store);
        break;
    }
  }
}

class _SubcategoryRow extends StatelessWidget {
  const _SubcategoryRow({
    required this.sub,
    required this.parent,
    required this.store,
  });

  final AppCategory sub;
  final AppCategory parent;
  final DashboardStore store;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(left: 8),
      child: Row(
        children: [
          const Icon(Icons.subdirectory_arrow_right, size: 16),
          const SizedBox(width: 8),
          Expanded(child: Text(sub.name)),
          PopupMenuButton<String>(
            onSelected: (v) async {
              if (v == 'rename') {
                await _rename(context, sub, store);
              } else if (v == 'delete') {
                await _deleteSubcategory(context, sub, store);
              }
            },
            itemBuilder: (ctx) => const [
              PopupMenuItem(value: 'rename', child: Text('Rename')),
              PopupMenuItem(
                  value: 'delete',
                  child: Text('Delete', style: TextStyle(color: Colors.red))),
            ],
            icon: const Icon(Icons.more_vert, size: 18),
          ),
        ],
      ),
    );
  }
}

Future<void> _rename(
    BuildContext context, AppCategory cat, DashboardStore store) async {
  final ctl = TextEditingController(text: cat.name);
  final result = await showDialog<String?>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text('Rename ${cat.name}'),
      content: TextField(
        controller: ctl,
        autofocus: true,
        decoration: const InputDecoration(labelText: 'Name'),
      ),
      actions: [
        TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Cancel')),
        FilledButton(
          onPressed: () {
            final v = ctl.text.trim();
            if (v.isEmpty) return;
            Navigator.of(ctx).pop(v);
          },
          child: const Text('Save'),
        ),
      ],
    ),
  );
  if (result == null) return;
  try {
    await store.repo.updateCategory(cat.id, name: result);
    await store.refresh();
  } catch (e) {
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Rename failed: $e')),
      );
    }
  }
}

Future<void> _changeType(
    BuildContext context, AppCategory cat, DashboardStore store) async {
  CategoryType selected = cat.type;
  final result = await showDialog<CategoryType?>(
    context: context,
    builder: (ctx) => StatefulBuilder(builder: (ctx, setState) {
      return AlertDialog(
        title: Text('Type — ${cat.name}'),
        content: _TypeSelector(
          value: selected,
          onChanged: (v) => setState(() => selected = v),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(ctx).pop(),
              child: const Text('Cancel')),
          FilledButton(
            onPressed: () => Navigator.of(ctx).pop(selected),
            child: const Text('Save'),
          ),
        ],
      );
    }),
  );
  if (result == null) return;
  try {
    await store.repo.updateCategory(cat.id, type: result);
    await store.refresh();
  } catch (e) {
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Update failed: $e')),
      );
    }
  }
}

Future<void> _delete(
    BuildContext context, CategoryNode node, DashboardStore store) async {
  final hasSubs = node.subcategories.isNotEmpty;
  bool cascade = false;
  final result = await showDialog<bool>(
    context: context,
    builder: (ctx) => StatefulBuilder(builder: (ctx, setState) {
      return AlertDialog(
        title: Text('Delete ${node.category.name}?'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
                'Transactions in this category will become uncategorized.'),
            if (hasSubs) ...[
              const SizedBox(height: 12),
              Text(
                '${node.subcategories.length} subcategor${node.subcategories.length == 1 ? "y" : "ies"} attached.',
              ),
              RadioListTile<bool>(
                title: const Text('Promote subcategories to top-level'),
                value: false,
                groupValue: cascade,
                onChanged: (v) => setState(() => cascade = v ?? false),
                dense: true,
              ),
              RadioListTile<bool>(
                title: const Text('Delete subcategories too'),
                value: true,
                groupValue: cascade,
                onChanged: (v) => setState(() => cascade = v ?? true),
                dense: true,
              ),
            ],
          ],
        ),
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
            child: const Text('Delete'),
          ),
        ],
      );
    }),
  );
  if (result != true) return;
  try {
    await store.repo.deleteCategory(node.category.id, cascade: cascade);
    await store.refresh();
  } catch (e) {
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Delete failed: $e')),
      );
    }
  }
}

Future<void> _deleteSubcategory(
    BuildContext context, AppCategory sub, DashboardStore store) async {
  final ok = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text('Delete ${sub.name}?'),
      content: const Text('Transactions tagged with this subcategory will keep their parent category.'),
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
          child: const Text('Delete'),
        ),
      ],
    ),
  );
  if (ok != true) return;
  try {
    await store.repo.deleteCategory(sub.id);
    await store.refresh();
  } catch (e) {
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Delete failed: $e')),
      );
    }
  }
}

String _typeLabel(CategoryType t) {
  switch (t) {
    case CategoryType.expense:
      return 'expense';
    case CategoryType.income:
      return 'income';
    case CategoryType.transfer:
      return 'transfer';
  }
}

class _CategoryFormResult {
  _CategoryFormResult({required this.name, required this.type});
  final String name;
  final CategoryType type;
}

class _TypeSelector extends StatelessWidget {
  const _TypeSelector({required this.value, required this.onChanged});

  final CategoryType value;
  final ValueChanged<CategoryType> onChanged;

  @override
  Widget build(BuildContext context) {
    return SegmentedButton<CategoryType>(
      segments: const [
        ButtonSegment(value: CategoryType.expense, label: Text('Expense')),
        ButtonSegment(value: CategoryType.income, label: Text('Income')),
        ButtonSegment(value: CategoryType.transfer, label: Text('Transfer')),
      ],
      selected: {value},
      onSelectionChanged: (s) => onChanged(s.first),
    );
  }
}
