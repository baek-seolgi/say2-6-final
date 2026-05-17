/// 환자 응급실 방문 1건 — backend GET /encounters/list 응답 매핑.
/// freezed 도입 전이라 일단 plain class로 시작. 추후 freezed로 마이그레이션.
class Encounter {
  final String encounterId;
  final String patientId;
  final String? subjectId; // MIMIC subject_id (있을 때만)
  final String patientName; // PHI anonymized (성+○○)
  final int? patientAge;
  final String? patientGender; // 'male'|'female'|'unknown'
  final String? chiefComplaint;
  final DateTime startedAt;
  final String status; // 'active'|'closed'
  final String? reportStatus; // 'preliminary'|'reviewed'|'signed' or null
  final String? aiRiskLevel; // 'routine'|'urgent'|'critical' or null

  const Encounter({
    required this.encounterId,
    required this.patientId,
    required this.patientName,
    required this.startedAt,
    required this.status,
    this.subjectId,
    this.patientAge,
    this.patientGender,
    this.chiefComplaint,
    this.reportStatus,
    this.aiRiskLevel,
  });

  factory Encounter.fromJson(Map<String, dynamic> j) => Encounter(
        encounterId: j['encounter_id'] as String,
        patientId: j['patient_id'] as String,
        subjectId: j['subject_id'] as String?,
        patientName: (j['patient_name'] as String?) ?? '익명',
        patientAge: j['patient_age'] as int?,
        patientGender: j['patient_gender'] as String?,
        chiefComplaint: j['chief_complaint'] as String?,
        startedAt: DateTime.parse(j['started_at'] as String),
        status: (j['status'] as String?) ?? 'active',
        reportStatus: j['report_status'] as String?,
        aiRiskLevel: j['ai_risk_level'] as String?,
      );
}
