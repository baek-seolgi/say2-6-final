import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/encounter.dart';
import 'client.dart';

/// 환자 목록 — backend GET /encounters/list 호출.
final encountersListProvider = FutureProvider.autoDispose
    .family<List<Encounter>, String>((ref, status) async {
  final dio = ref.watch(dioProvider);
  final Response<dynamic> res = await dio.get(
    '/encounters/list',
    queryParameters: {'status': status, 'limit': 50},
  );
  final list = (res.data as List).cast<Map<String, dynamic>>();
  return list.map(Encounter.fromJson).toList();
});
