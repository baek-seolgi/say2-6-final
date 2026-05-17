import 'package:flutter/material.dart';

import '../../shared/theme/app_theme.dart';

/// 흉부 X-ray 검사결과지 — 백엔드 CXR modal 응답을 사람이 읽을 수 있게.
/// 웹의 CXRView에서 핵심 정보만 추려서 모바일 한 화면에 정리.
class CxrClinicalSheet extends StatelessWidget {
  final String patientName;
  final int age;
  final String sex;
  final String? patientId;
  final String? subjectId; // MIMIC subject_id → /assets/cxr/{id}
  final Map<String, dynamic>? measurements;
  final List<String> findingsText;
  final String? impression;
  final String? summary;
  final String? riskLevel;

  const CxrClinicalSheet({
    super.key,
    this.patientName = '환자',
    this.age = 0,
    this.sex = 'M',
    this.patientId,
    this.subjectId,
    this.measurements,
    this.findingsText = const [],
    this.impression,
    this.summary,
    this.riskLevel,
  });

  String get _sexLabel => sex == 'M' ? '남' : sex == 'F' ? '여' : sex;

  @override
  Widget build(BuildContext context) {
    final m = measurements ?? const {};
    final ctr = m['ctr'] as num?;
    final ctrStatus = m['ctr_status'] as String?;
    final lungArea = m['lung_area_ratio'] as num?;
    final leftCp = m['left_cp_status'] as String?;
    final rightCp = m['right_cp_status'] as String?;
    final leftCpAngle = m['left_cp_angle'] as num?;
    final rightCpAngle = m['right_cp_angle'] as num?;

    // backend API_BASE_URL는 dio config에 박혀있고 여기선 절대 URL 만들기 어려움.
    // 일단 같은 origin 가정.
    final imageUrl = subjectId != null ? '/assets/cxr/$subjectId' : null;

    return Container(
      color: Colors.white,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // 헤더
          _Header(
            patientName: patientName,
            age: age,
            sexLabel: _sexLabel,
            patientId: patientId,
            riskLevel: riskLevel,
          ),

          // CXR 이미지 영역
          AspectRatio(
            aspectRatio: 4 / 3,
            child: Container(
              color: Colors.black,
              child: imageUrl != null
                  ? Image.network(
                      'http://localhost:8000$imageUrl',
                      fit: BoxFit.contain,
                      errorBuilder: (_, _, _) => const _ImagePlaceholder(),
                    )
                  : const _ImagePlaceholder(),
            ),
          ),

          // 측정값
          Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const _SectionLabel('측정값 (Measurements)'),
                const SizedBox(height: 6),
                _MeasureRow(
                  k: '심흉곽비 (CTR)',
                  v: ctr != null ? ctr.toStringAsFixed(2) : '—',
                  status: ctrStatus,
                  ref: '< 0.50',
                ),
                _MeasureRow(
                  k: '폐 면적 비율',
                  v: lungArea != null
                      ? '${(lungArea * 100).toStringAsFixed(1)}%'
                      : '—',
                  ref: '> 50%',
                ),
                _MeasureRow(
                  k: '좌측 늑횡각',
                  v: leftCpAngle != null
                      ? '${leftCpAngle.toStringAsFixed(0)}°'
                      : '—',
                  status: leftCp,
                  ref: '예각',
                ),
                _MeasureRow(
                  k: '우측 늑횡각',
                  v: rightCpAngle != null
                      ? '${rightCpAngle.toStringAsFixed(0)}°'
                      : '—',
                  status: rightCp,
                  ref: '예각',
                ),
              ],
            ),
          ),

          // 판독 소견
          if (findingsText.isNotEmpty) ...[
            Padding(
              padding:
                  const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const _SectionLabel('판독 소견 (Findings)'),
                  const SizedBox(height: 6),
                  for (final f in findingsText)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 4),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text('· ',
                              style: TextStyle(
                                  color: AppColors.vunoCyanDim,
                                  fontWeight: FontWeight.bold)),
                          Expanded(
                            child: Text(f,
                                style: const TextStyle(
                                    fontSize: 11,
                                    color: AppColors.slate700,
                                    height: 1.5)),
                          ),
                        ],
                      ),
                    ),
                ],
              ),
            ),
          ],

          // 결론
          if (impression != null && impression!.isNotEmpty)
            Container(
              margin: const EdgeInsets.all(12),
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: AppColors.slate50,
                border: Border.all(color: AppColors.slate300),
                borderRadius: BorderRadius.circular(4),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const _SectionLabel('결론 (Impression)'),
                  const SizedBox(height: 4),
                  Text(impression!,
                      style: const TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.bold,
                          color: AppColors.slate900,
                          height: 1.5)),
                ],
              ),
            )
          else if (summary != null && summary!.isNotEmpty)
            Container(
              margin: const EdgeInsets.all(12),
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: AppColors.slate50,
                border: Border.all(color: AppColors.slate300),
                borderRadius: BorderRadius.circular(4),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const _SectionLabel('요약 (Summary)'),
                  const SizedBox(height: 4),
                  Text(summary!,
                      style: const TextStyle(
                          fontSize: 11,
                          color: AppColors.slate800,
                          height: 1.6)),
                ],
              ),
            ),

          _Footer(modal: 'CXR'),
        ],
      ),
    );
  }
}

Future<void> showCxrClinicalSheet(
  BuildContext context, {
  required String patientName,
  required int age,
  required String sex,
  String? patientId,
  String? subjectId,
  Map<String, dynamic>? measurements,
  List<String> findingsText = const [],
  String? impression,
  String? summary,
  String? riskLevel,
}) {
  return showDialog<void>(
    context: context,
    barrierColor: Colors.black54,
    builder: (ctx) => Dialog.fullscreen(
      backgroundColor: AppColors.slate100,
      child: Scaffold(
        backgroundColor: AppColors.slate100,
        appBar: AppBar(
          leading: const SizedBox(),
          leadingWidth: 0,
          title: const Text('흉부 X-ray 판독결과지',
              style: TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.bold,
                  color: AppColors.slate900)),
          actions: [
            IconButton(
                icon: const Icon(Icons.close, color: AppColors.slate700),
                onPressed: () => Navigator.pop(ctx)),
          ],
        ),
        body: SingleChildScrollView(
          padding: const EdgeInsets.all(12),
          child: Container(
            decoration: BoxDecoration(
              color: Colors.white,
              border: Border.all(color: AppColors.slate300),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withAlpha(20),
                  blurRadius: 8,
                  offset: const Offset(0, 2),
                ),
              ],
            ),
            child: CxrClinicalSheet(
              patientName: patientName,
              age: age,
              sex: sex,
              patientId: patientId,
              subjectId: subjectId,
              measurements: measurements,
              findingsText: findingsText,
              impression: impression,
              summary: summary,
              riskLevel: riskLevel,
            ),
          ),
        ),
      ),
    ),
  );
}

// ────────────────────────────────────────────────────────────
// Shared helpers
// ────────────────────────────────────────────────────────────
class _Header extends StatelessWidget {
  final String patientName;
  final int age;
  final String sexLabel;
  final String? patientId;
  final String? riskLevel;
  const _Header({
    required this.patientName,
    required this.age,
    required this.sexLabel,
    this.patientId,
    this.riskLevel,
  });

  @override
  Widget build(BuildContext context) {
    final (riskBg, riskFg, riskLabel) = switch (riskLevel) {
      'critical' => (
          AppColors.critical.withAlpha(40),
          AppColors.critical,
          'CRITICAL'
        ),
      'urgent' => (
          AppColors.urgent.withAlpha(40),
          AppColors.urgent,
          'URGENT'
        ),
      'routine' => (
          AppColors.emerald100,
          AppColors.emerald700,
          'ROUTINE'
        ),
      _ => (AppColors.slate100, AppColors.slate600, '—'),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: const BoxDecoration(
          border: Border(bottom: BorderSide(color: AppColors.slate300))),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('$patientName · $sexLabel · $age세',
                    style: const TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.bold,
                        color: AppColors.slate900)),
                if (patientId != null)
                  Text('ID: $patientId',
                      style: const TextStyle(
                          fontSize: 10,
                          color: AppColors.slate500,
                          fontFamily: 'monospace')),
              ],
            ),
          ),
          Container(
            padding:
                const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            decoration: BoxDecoration(
                color: riskBg, borderRadius: BorderRadius.circular(2)),
            child: Text(riskLabel,
                style: TextStyle(
                    color: riskFg,
                    fontSize: 10,
                    fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );
  }
}

class _Footer extends StatelessWidget {
  final String modal;
  const _Footer({required this.modal});
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: const BoxDecoration(
          border: Border(top: BorderSide(color: AppColors.slate200))),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text('say-6 Deep$modal v2.0',
              style: const TextStyle(
                  fontSize: 9,
                  color: AppColors.slate400,
                  fontFamily: 'monospace')),
          const Text('응급실 멀티모달 AI 진단 보조',
              style: TextStyle(
                  fontSize: 9,
                  color: AppColors.slate400,
                  fontFamily: 'monospace')),
        ],
      ),
    );
  }
}

class _SectionLabel extends StatelessWidget {
  final String text;
  const _SectionLabel(this.text);
  @override
  Widget build(BuildContext context) => Text(text,
      style: const TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.bold,
          color: AppColors.slate600));
}

class _MeasureRow extends StatelessWidget {
  final String k;
  final String v;
  final String? status; // 'normal' / 'enlarged' / 'blunt' etc.
  final String? ref;
  const _MeasureRow({required this.k, required this.v, this.status, this.ref});

  @override
  Widget build(BuildContext context) {
    final abnormal = status != null &&
        status != 'normal' &&
        status != 'unknown' &&
        status!.isNotEmpty;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        children: [
          Expanded(
              flex: 4,
              child: Text(k,
                  style: const TextStyle(
                      fontSize: 11, color: AppColors.slate700))),
          Expanded(
            flex: 3,
            child: Text(v,
                textAlign: TextAlign.right,
                style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.bold,
                    fontFamily: 'monospace',
                    color: abnormal
                        ? AppColors.critical
                        : AppColors.slate900)),
          ),
          if (ref != null) ...[
            const SizedBox(width: 8),
            Expanded(
              flex: 3,
              child: Text(ref!,
                  style: const TextStyle(
                      fontSize: 10,
                      color: AppColors.slate400,
                      fontFamily: 'monospace')),
            ),
          ],
        ],
      ),
    );
  }
}

class _ImagePlaceholder extends StatelessWidget {
  const _ImagePlaceholder();
  @override
  Widget build(BuildContext context) {
    return const Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.image_outlined, size: 48, color: Colors.white24),
          SizedBox(height: 8),
          Text('CXR 이미지', style: TextStyle(color: Colors.white38)),
        ],
      ),
    );
  }
}
