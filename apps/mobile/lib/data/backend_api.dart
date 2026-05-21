// Thin wrapper around the Hono backend (mounted at /api on Vercel). Used for
// operations that cannot run from the device — Plaid token exchange, Teller
// mTLS sync, the aggregator refresh, etc. The web app talks to the same
// endpoints via session cookies; we authenticate by attaching the Supabase
// access token as Bearer in every request.
//
// Why not just write to Supabase directly:
//   - Plaid Link gives us a `public_token` that has to be swapped for an
//     `access_token` server-side (PLAID_CLIENT_ID + secret cannot live on a
//     phone).
//   - Teller balance/transaction calls use mTLS with our private key.
//   - Aggregator sync runs the categorization heuristics over hundreds of
//     transactions; doing that on a phone over PostgREST would be slow.

import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';

import '../config.dart';

class BackendApiException implements Exception {
  BackendApiException(this.status, this.path, this.message);
  final int status;
  final String path;
  final String message;
  @override
  String toString() => 'BackendApi $status $path: $message';
}

class BackendApi {
  BackendApi({http.Client? client, SupabaseClient? supabase})
      : _http = client ?? http.Client(),
        _supabase = supabase ?? Supabase.instance.client;

  final http.Client _http;
  final SupabaseClient _supabase;

  String get _base => AppConfig.apiBaseUrl;

  Future<Map<String, String>> _headers({bool json = false}) async {
    final token = _supabase.auth.currentSession?.accessToken;
    final h = <String, String>{
      if (token != null) 'Authorization': 'Bearer $token',
      if (json) 'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    return h;
  }

  Future<dynamic> _request(
    String method,
    String path, {
    Object? body,
  }) async {
    final uri = Uri.parse('$_base$path');
    final headers = await _headers(json: body != null);
    late http.Response res;
    final encoded = body == null ? null : jsonEncode(body);
    switch (method) {
      case 'GET':
        res = await _http.get(uri, headers: headers);
        break;
      case 'POST':
        res = await _http.post(uri, headers: headers, body: encoded);
        break;
      case 'PATCH':
        res = await _http.patch(uri, headers: headers, body: encoded);
        break;
      case 'PUT':
        res = await _http.put(uri, headers: headers, body: encoded);
        break;
      case 'DELETE':
        res = await _http.delete(uri, headers: headers, body: encoded);
        break;
      default:
        throw ArgumentError('Unsupported method: $method');
    }
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw BackendApiException(res.statusCode, path, res.body);
    }
    if (res.body.isEmpty) return null;
    try {
      return jsonDecode(res.body);
    } catch (_) {
      return res.body;
    }
  }

  // ---------------------------------------------------------------------------
  // Aggregator refresh: hits both Teller and Plaid, returns counts.
  // ---------------------------------------------------------------------------

  Future<SyncResult> syncAll() async {
    final j = await _request('POST', '/aggregator/sync') as Map<String, dynamic>;
    final totals = (j['totals'] as Map?) ?? const {};
    return SyncResult(
      accounts: (totals['accounts'] as num?)?.toInt() ?? 0,
      balances: (totals['balances'] as num?)?.toInt() ?? 0,
      transactions: (totals['transactions'] as num?)?.toInt() ?? 0,
      syncedAt: j['syncedAt'] as String?,
      teller: j['teller'],
      plaid: j['plaid'],
    );
  }

  // ---------------------------------------------------------------------------
  // Plaid
  // ---------------------------------------------------------------------------

  Future<PlaidConfig> plaidConfig() async {
    final j = await _request('GET', '/plaid/config') as Map<String, dynamic>;
    return PlaidConfig(
      env: j['env'] as String? ?? 'sandbox',
      configured: j['configured'] as bool? ?? false,
    );
  }

  Future<String> plaidLinkToken() async {
    final j =
        await _request('POST', '/plaid/link-token') as Map<String, dynamic>;
    return j['linkToken'] as String;
  }

  /// Exchanges the Plaid Link `public_token` for an access_token server-side
  /// and persists the new plaid_items row.
  Future<void> plaidCreateItem({
    required String publicToken,
    String? institutionName,
    String? institutionId,
  }) async {
    await _request('POST', '/plaid/items', body: {
      'publicToken': publicToken,
      'metadata': {
        if (institutionName != null || institutionId != null)
          'institution': {
            if (institutionName != null) 'name': institutionName,
            if (institutionId != null) 'institution_id': institutionId,
          },
      },
    });
  }

  Future<void> plaidDeleteItem(int id) async {
    await _request('DELETE', '/plaid/items/$id');
  }

  // ---------------------------------------------------------------------------
  // Teller
  // ---------------------------------------------------------------------------

  Future<TellerConfig> tellerConfig() async {
    final j = await _request('GET', '/teller/config') as Map<String, dynamic>;
    return TellerConfig(
      appId: j['appId'] as String?,
      environment: j['environment'] as String? ?? 'sandbox',
      mtlsConfigured: j['mtlsConfigured'] as bool? ?? false,
    );
  }

  /// Persists a Teller Connect callback payload (enrollment + access token)
  /// server-side. The payload shape comes straight from Teller's JS SDK.
  Future<void> tellerCreateEnrollment(Map<String, dynamic> payload) async {
    await _request('POST', '/teller/enrollments', body: payload);
  }

  Future<void> tellerDeleteEnrollment(int id) async {
    await _request('DELETE', '/teller/enrollments/$id');
  }
}

class SyncResult {
  SyncResult({
    required this.accounts,
    required this.balances,
    required this.transactions,
    this.syncedAt,
    this.teller,
    this.plaid,
  });
  final int accounts;
  final int balances;
  final int transactions;
  final String? syncedAt;
  final dynamic teller;
  final dynamic plaid;
}

class PlaidConfig {
  PlaidConfig({required this.env, required this.configured});
  final String env;
  final bool configured;
}

class TellerConfig {
  TellerConfig({
    required this.appId,
    required this.environment,
    required this.mtlsConfigured,
  });
  final String? appId;
  final String environment;
  final bool mtlsConfigured;
}
