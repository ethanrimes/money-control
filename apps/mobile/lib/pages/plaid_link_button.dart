// Plaid Link button (native, via plaid_flutter SDK).
//
// Flow:
//   1. Tap → call /plaid/link-token on the backend to mint a link_token
//   2. Configure PlaidLink with that token, then `open()`
//   3. On success: backend exchanges the public_token for an access_token
//   4. Trigger an aggregator sync so the user immediately sees new data

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:plaid_flutter/plaid_flutter.dart';

import '../data/backend_api.dart';
import '../data/dashboard_store.dart';

class PlaidLinkButton extends StatefulWidget {
  const PlaidLinkButton({
    super.key,
    required this.api,
    required this.store,
  });

  final BackendApi api;
  final DashboardStore store;

  @override
  State<PlaidLinkButton> createState() => _PlaidLinkButtonState();
}

class _PlaidLinkButtonState extends State<PlaidLinkButton> {
  bool _busy = false;
  bool? _configured;
  String? _status;
  bool _statusError = false;
  StreamSubscription<LinkSuccess>? _onSuccess;
  StreamSubscription<LinkExit>? _onExit;
  StreamSubscription<LinkEvent>? _onEvent;

  @override
  void initState() {
    super.initState();
    _onSuccess = PlaidLink.onSuccess.listen(_handleSuccess);
    _onExit = PlaidLink.onExit.listen(_handleExit);
    _onEvent = PlaidLink.onEvent.listen((_) {});
    widget.api.plaidConfig().then((c) {
      if (mounted) setState(() => _configured = c.configured);
    }).catchError((e) {
      if (mounted) setState(() => _configured = false);
    });
  }

  @override
  void dispose() {
    _onSuccess?.cancel();
    _onExit?.cancel();
    _onEvent?.cancel();
    super.dispose();
  }

  Future<void> _open() async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _status = null;
    });
    try {
      final token = await widget.api.plaidLinkToken();
      await PlaidLink.create(configuration: LinkTokenConfiguration(token: token));
      await PlaidLink.open();
    } catch (e) {
      if (mounted) {
        setState(() {
          _status = 'Could not open Plaid Link: $e';
          _statusError = true;
          _busy = false;
        });
      }
    }
  }

  Future<void> _handleSuccess(LinkSuccess s) async {
    try {
      await widget.api.plaidCreateItem(
        publicToken: s.publicToken,
        institutionName: s.metadata.institution?.name,
        institutionId: s.metadata.institution?.id,
      );
      if (mounted) {
        setState(() {
          _status = 'Linked ${s.metadata.institution?.name ?? "institution"}. Syncing…';
          _statusError = false;
        });
      }
      final sync = await widget.api.syncAll();
      await widget.store.refresh();
      if (mounted) {
        setState(() {
          _status =
              'Synced ${sync.transactions} new transaction${sync.transactions == 1 ? "" : "s"}.';
          _statusError = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _status = 'Failed to finish link: $e';
          _statusError = true;
        });
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _handleExit(LinkExit e) {
    if (!mounted) return;
    setState(() {
      _busy = false;
      if (e.error != null) {
        _status = [
          e.error?.code,
          e.error?.message,
          if (e.metadata.institution?.name != null) 'at ${e.metadata.institution!.name}',
        ].where((s) => s != null && s.isNotEmpty).join(' — ');
        _statusError = true;
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final disabled = _configured == false || _busy;
    final hint = _configured == false
        ? 'Plaid is not configured on the backend.'
        : 'Link via Plaid (broad coverage, Amex/Fidelity, etc).';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        FilledButton.icon(
          onPressed: disabled ? null : _open,
          icon: const Icon(Icons.add_link),
          label: Text(_busy ? 'Opening…' : 'Link via Plaid'),
        ),
        const SizedBox(height: 4),
        Text(
          _status ?? hint,
          style: TextStyle(
            fontSize: 12,
            color: _status != null && _statusError
                ? Theme.of(context).colorScheme.error
                : Theme.of(context).textTheme.bodySmall?.color,
          ),
        ),
      ],
    );
  }
}
