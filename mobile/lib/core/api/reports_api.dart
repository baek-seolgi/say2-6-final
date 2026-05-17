import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'client.dart';

class ReportData {
  final int id;
  final String encounterId;
  final String status; // preliminary / reviewed / signed / amended
  final String? aiDiagnosis;
  final String? physicianEdits;
  final String? signedBy;
  final String? aiRiskLevel;

  const ReportData({
    required this.id,
    required this.encounterId,
    required this.status,
    this.aiDiagnosis,
    this.physicianEdits,
    this.signedBy,
    this.aiRiskLevel,
  });

  factory ReportData.fromJson(Map<String, dynamic> j) => ReportData(
        id: j['id'] as int,
        encounterId: j['encounter_id'] as String,
        status: j['status'] as String,
        aiDiagnosis: j['ai_diagnosis'] as String?,
        physicianEdits: j['physician_edits'] as String?,
        signedBy: j['signed_by'] as String?,
        aiRiskLevel: j['ai_risk_level'] as String?,
      );
}

/// 소견서 로딩 — 없으면 generate.
final reportProvider = FutureProvider.autoDispose
    .family<ReportData, String>((ref, encounterId) async {
  final dio = ref.watch(dioProvider);

  // 1) 기존 소견서 조회
  final getRes = await dio.get('/reports/by-encounter/$encounterId');
  if (getRes.data != null) {
    return ReportData.fromJson(getRes.data as Map<String, dynamic>);
  }

  // 2) 없으면 generate
  final genRes = await dio.post('/reports/$encounterId/generate');
  final data = genRes.data as Map<String, dynamic>;
  // generate는 ReportData와 약간 다른 shape: {report_id, status, narrative, ...}
  return ReportData(
    id: (data['report_id'] as num).toInt(),
    encounterId: encounterId,
    status: (data['status'] as String?) ?? 'preliminary',
    aiDiagnosis: data['narrative'] as String?,
  );
});

Future<void> reviewReport(WidgetRef ref, int reportId,
    {String? physicianEdits, required String encounterId}) async {
  final dio = ref.read(dioProvider);
  await dio.patch('/reports/$reportId/review',
      data: {'physician_edits': physicianEdits});
  ref.invalidate(reportProvider(encounterId));
}

Future<void> signReport(WidgetRef ref, int reportId,
    {required String signedBy,
    String? physicianEdits,
    required String encounterId}) async {
  final dio = ref.read(dioProvider);
  await dio.post('/reports/$reportId/sign', data: {
    'signed_by': signedBy,
    'physician_edits': physicianEdits,
  });
  ref.invalidate(reportProvider(encounterId));
}
