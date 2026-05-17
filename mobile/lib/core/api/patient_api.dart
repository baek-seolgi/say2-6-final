import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/ai_rec.dart';
import 'client.dart';

/// 환자 상세 — AI 권고 + 모달 결과를 함께 가져오는 묶음 provider.
/// (단일 화면이 둘 다 필요하므로 한 번의 watch로 처리)
class PatientDetailData {
  final List<AIRec> recommendations;
  final Map<String, ModalSummary> modalResults; // key: 'ECG'/'CXR'/'LAB'
  const PatientDetailData(
      {required this.recommendations, required this.modalResults});
}

final patientDetailProvider = FutureProvider.autoDispose
    .family<PatientDetailData, String>((ref, encounterId) async {
  final dio = ref.watch(dioProvider);

  // 두 endpoint 병렬 호출
  final results = await Future.wait([
    dio.get('/encounters/$encounterId/service-requests'),
    dio.get('/encounters/$encounterId/modal-results'),
  ]);

  // 1) ServiceRequest 파싱
  final srList = (results[0].data as List).cast<Map<String, dynamic>>();
  final recs = srList
      .map(AIRec.fromFhir)
      .where((r) => r != null)
      .cast<AIRec>()
      .toList()
    ..sort((a, b) => a.authoredOn.compareTo(b.authoredOn));

  // 2) modal-results 파싱 — raw JSON도 함께 보존 (검사결과지에서 활용)
  final mrData = (results[1].data as Map<String, dynamic>);
  final mrResults = (mrData['results'] as Map?) ?? const {};
  final modalMap = <String, ModalSummary>{};
  for (final m in ['ECG', 'CXR', 'LAB']) {
    final entry = mrResults[m] as Map?;
    if (entry == null) continue;
    modalMap[m] = ModalSummary(
      modality: m,
      status: entry['status'] as String? ?? 'unknown',
      summary: entry['summary'] as String?,
      raw: Map<String, dynamic>.from(entry),
    );
  }

  return PatientDetailData(recommendations: recs, modalResults: modalMap);
});

/// AI 권고 승인 — POST /orders/{sr_id}/approve.
/// 성공 시 patientDetailProvider invalidate해서 새로고침.
Future<void> approveOrder(WidgetRef ref, String srId, String encounterId) async {
  final dio = ref.read(dioProvider);
  await dio.post('/orders/$srId/approve');
  // 약간 지연 후 새로고침 — 백엔드가 모달 호출 시작할 시간 확보
  await Future.delayed(const Duration(milliseconds: 400));
  ref.invalidate(patientDetailProvider(encounterId));
}
