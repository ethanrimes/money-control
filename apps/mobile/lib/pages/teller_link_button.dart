// Teller Connect via WebView. Teller does not publish a Flutter SDK, so we
// embed their cdn `connect.js` in a tiny HTML shim, intercept the
// `onSuccess` callback, and forward the enrollment payload to our backend
// (which can keep the access_token, encrypted, server-side).
//
// The Teller JS SDK calls window.webkit.messageHandlers.<name>.postMessage
// in iOS WKWebView; we provide a `JavascriptChannel` named `TellerBridge`
// that catches every payload.

import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../data/backend_api.dart';
import '../data/dashboard_store.dart';

class TellerLinkButton extends StatefulWidget {
  const TellerLinkButton({
    super.key,
    required this.api,
    required this.store,
  });

  final BackendApi api;
  final DashboardStore store;

  @override
  State<TellerLinkButton> createState() => _TellerLinkButtonState();
}

class _TellerLinkButtonState extends State<TellerLinkButton> {
  TellerConfig? _config;
  String? _error;
  bool _busy = false;
  String? _status;
  bool _statusError = false;

  @override
  void initState() {
    super.initState();
    widget.api.tellerConfig().then((c) {
      if (mounted) setState(() => _config = c);
    }).catchError((e) {
      if (mounted) setState(() => _error = e.toString());
    });
  }

  Future<void> _open() async {
    final cfg = _config;
    if (cfg == null || cfg.appId == null) return;
    setState(() {
      _busy = true;
      _status = null;
    });
    final payload = await Navigator.of(context).push<Map<String, dynamic>?>(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => _TellerConnectPage(config: cfg),
      ),
    );
    if (!mounted) return;
    if (payload == null) {
      setState(() => _busy = false);
      return;
    }
    try {
      await widget.api.tellerCreateEnrollment(payload);
      setState(() {
        _status = 'Linked ${payload['enrollment']?['institution']?['name'] ?? "institution"}. Syncing…';
        _statusError = false;
      });
      final sync = await widget.api.syncAll();
      await widget.store.refresh();
      setState(() {
        _status =
            'Synced ${sync.transactions} new transaction${sync.transactions == 1 ? "" : "s"}.';
      });
    } catch (e) {
      setState(() {
        _status = 'Failed to save enrollment: $e';
        _statusError = true;
      });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final disabled = _busy ||
        _config == null ||
        _config!.appId == null ||
        !_config!.mtlsConfigured;
    String hint;
    if (_error != null) {
      hint = 'Could not load Teller config: $_error';
    } else if (_config == null) {
      hint = 'Loading Teller config…';
    } else if (_config!.appId == null) {
      hint = 'Set TELLER_APP_ID on the backend to enable linking.';
    } else if (!_config!.mtlsConfigured) {
      hint = 'Teller mTLS certificate/private key not configured on the backend.';
    } else {
      hint = 'Link via Teller (Chase, BofA, Citi — fast, mTLS-secured).';
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        OutlinedButton.icon(
          onPressed: disabled ? null : _open,
          icon: const Icon(Icons.account_balance),
          label: Text(_busy ? 'Opening…' : 'Link via Teller'),
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

class _TellerConnectPage extends StatefulWidget {
  const _TellerConnectPage({required this.config});
  final TellerConfig config;

  @override
  State<_TellerConnectPage> createState() => _TellerConnectPageState();
}

class _TellerConnectPageState extends State<_TellerConnectPage> {
  late final WebViewController _controller;
  bool _loaded = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(const Color(0x00000000))
      ..addJavaScriptChannel(
        'TellerBridge',
        onMessageReceived: (msg) => _onMessage(msg.message),
      )
      ..setNavigationDelegate(
        NavigationDelegate(
          onPageFinished: (_) => setState(() => _loaded = true),
          onWebResourceError: (err) =>
              setState(() => _error = '${err.errorCode}: ${err.description}'),
        ),
      )
      ..loadHtmlString(_html(widget.config), baseUrl: 'https://teller.io/');
  }

  void _onMessage(String raw) {
    final Map<String, dynamic> json;
    try {
      json = jsonDecode(raw) as Map<String, dynamic>;
    } catch (_) {
      return;
    }
    final type = json['type'] as String?;
    switch (type) {
      case 'success':
        Navigator.of(context).pop(json['payload'] as Map<String, dynamic>?);
        break;
      case 'exit':
        Navigator.of(context).pop();
        break;
      case 'failure':
        setState(() => _error = (json['payload'] ?? 'Teller error').toString());
        break;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Link a bank — Teller'),
        actions: [
          IconButton(
            icon: const Icon(Icons.close),
            onPressed: () => Navigator.of(context).pop(),
          ),
        ],
      ),
      body: Stack(
        children: [
          WebViewWidget(controller: _controller),
          if (!_loaded)
            const Center(child: CircularProgressIndicator()),
          if (_error != null)
            Positioned(
              left: 0,
              right: 0,
              bottom: 0,
              child: Container(
                padding: const EdgeInsets.all(12),
                color: Theme.of(context).colorScheme.errorContainer,
                child: Text(
                  _error!,
                  style: TextStyle(
                    color: Theme.of(context).colorScheme.onErrorContainer,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }

  static String _html(TellerConfig cfg) {
    return '''
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Teller Connect</title>
  <script src="https://cdn.teller.io/connect/connect.js"></script>
</head>
<body style="margin:0;background:#ffffff;font-family:-apple-system,system-ui,sans-serif;">
<script>
  function post(type, payload) {
    try {
      window.TellerBridge.postMessage(JSON.stringify({ type: type, payload: payload }));
    } catch (e) {}
  }
  function start() {
    if (!window.TellerConnect) { setTimeout(start, 100); return; }
    var teller = window.TellerConnect.setup({
      applicationId: ${jsonEncode(cfg.appId ?? '')},
      environment: ${jsonEncode(cfg.environment)},
      selectAccount: "multiple",
      products: ["transactions", "balance"],
      onSuccess: function(payload) { post('success', payload); },
      onExit: function() { post('exit', null); },
      onFailure: function(failure) { post('failure', failure); }
    });
    teller.open();
  }
  start();
</script>
</body>
</html>
''';
  }
}
