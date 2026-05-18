/// AI 권고 1건 — FHIR ServiceRequest를 파싱한 결과.
/// 웹 프론트의 parseRecommendations와 동일 의도.
class AIRec {
  final String srId;
  final String modality; // 'ECG' | 'CXR' | 'LAB'
  final String status;   // 'draft' | 'active' | 'completed' | 'revoked'
  final String reason;
  final DateTime authoredOn;
  final bool isManual;   // 의사 직접 오더 (reason prefix "의사 직접 오더")

  const AIRec({
    required this.srId,
    required this.modality,
    required this.status,
    required this.reason,
    required this.authoredOn,
    required this.isManual,
  });

  bool get isDraft => status == 'draft';
  bool get isRunning => status == 'active';
  bool get isDone => status == 'completed';

  static String? _detectModality(Map<String, dynamic> sr) {
    final code = (sr['code'] as Map?) ?? {};
    final codings = (code['coding'] as List?) ?? [];
    if (codings.isEmpty) return null;
    final display = ((codings.first as Map?)?['display'] as String? ?? '')
        .toUpperCase();
    if (display.contains('ECG') || display.contains('EKG')) {
      return 'ECG';
    }
    if (display.contains('CXR') ||
        display.contains('CHEST') ||
        display.contains('X-RAY')) {
      return 'CXR';
    }
    if (display.contains('LAB') || display.contains('BLOOD')) {
      return 'LAB';
    }
    return null;
  }

  static AIRec? fromFhir(Map<String, dynamic> sr) {
    final modality = _detectModality(sr);
    if (modality == null) return null;
    final reasonArr = (sr['reasonCode'] as List?) ?? [];
    final reason = reasonArr.isEmpty
        ? ''
        : ((reasonArr.first as Map?)?['text'] as String? ?? '');
    final authored =
        DateTime.tryParse(sr['authoredOn'] as String? ?? '') ?? DateTime.now();
    final isManual = RegExp(r'^의사\s*직접\s*오더').hasMatch(reason);
    return AIRec(
      srId: sr['id'] as String? ?? '',
      modality: modality,
      status: sr['status'] as String? ?? '',
      reason: reason,
      authoredOn: authored,
      isManual: isManual,
    );
  }
}

/// 모달 검사 요약 — backend /modal-results의 각 모달 항목.
class ModalSummary {
  final String modality; // ECG / CXR / LAB
  final String status;   // 'ok' / 'success' / 'error' / ...
  final String? summary; // 사람이 읽는 한 줄 요약
  // 검사결과지에서 활용할 raw 응답 (waveform, measurements, lab_summary 등)
  final Map<String, dynamic>? raw;

  const ModalSummary({
    required this.modality,
    required this.status,
    this.summary,
    this.raw,
  });

  bool get isDone => status == 'ok' || status == 'success';

  // ECG raw 데이터 헬퍼
  List<List<double>>? get ecgWaveform {
    final w = raw?['waveform'];
    if (w is! List) return null;
    return w
        .map((row) => (row as List).map((v) => (v as num).toDouble()).toList())
        .toList();
  }

  Map<String, dynamic>? get ecgVitals =>
      (raw?['ecg_vitals'] as Map?)?.cast<String, dynamic>();

  // 공통 findings
  List<Map<String, dynamic>> get findings {
    final f = raw?['findings'];
    if (f is! List) return const [];
    return f.cast<Map<String, dynamic>>();
  }

  String? get riskLevel => raw?['risk_level'] as String?;

  // CXR 전용
  Map<String, dynamic>? get cxrMeasurements =>
      (raw?['measurements'] as Map?)?.cast<String, dynamic>();
  // metadata 에 image_size, mask_base64, view 등이 들어있어 풀시트 오버레이에 사용
  Map<String, dynamic>? get cxrMetadata =>
      (raw?['metadata'] as Map?)?.cast<String, dynamic>();
  String? get cxrImpression => raw?['impression'] as String?;
  List<String> get cxrFindingsText {
    final ft = raw?['findings_text'];
    if (ft is List) return ft.cast<String>();
    return const [];
  }

  // LAB 전용
  List<Map<String, dynamic>> get labSummary {
    final l = raw?['lab_summary'];
    if (l is! List) return const [];
    return l.cast<Map<String, dynamic>>();
  }

  Map<String, dynamic>? get prognosis6h =>
      (raw?['prognosis_6h'] as Map?)?.cast<String, dynamic>();
}
