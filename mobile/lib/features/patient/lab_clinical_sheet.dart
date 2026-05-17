import 'package:flutter/material.dart';

import '../../shared/theme/app_theme.dart';

/// 혈액 검사 결과지 — backend LAB modal의 lab_summary + prognosis_6h.
class LabClinicalSheet extends StatelessWidget {
  final String patientName;
  final int age;
  final String sex;
  final String? patientId;
  final List<Map<String, dynamic>> labSummary;
  final Map<String, dynamic>? prognosis6h;
  final String? summary;
  final String? riskLevel;

  const LabClinicalSheet({
    super.key,
    this.patientName = '환자',
    this.age = 0,
    this.sex = 'M',
    this.patientId,
    this.labSummary = const [],
    this.prognosis6h,
    this.summary,
    this.riskLevel,
  });

  String get _sexLabel => sex == 'M' ? '남' : sex == 'F' ? '여' : sex;

  @override
  Widget build(BuildContext context) {
    return Container(
      color: Colors.white,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _Header(
            patientName: patientName,
            age: age,
            sexLabel: _sexLabel,
            patientId: patientId,
            riskLevel: riskLevel,
          ),
          // lab_summary 표
          Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const _SectionLabel('혈액 검사 결과 (Lab Summary)'),
                const SizedBox(height: 6),
                Container(
                  decoration: BoxDecoration(
                    border: Border.all(color: AppColors.slate200),
                    borderRadius: BorderRadius.circular(2),
                  ),
                  child: Column(
                    children: [
                      // 헤더
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 8, vertical: 6),
                        decoration: const BoxDecoration(
                          color: AppColors.slate100,
                          border: Border(
                              bottom: BorderSide(color: AppColors.slate200)),
                        ),
                        child: Row(
                          children: const [
                            Expanded(flex: 5, child: _ColH('항목')),
                            Expanded(
                                flex: 3,
                                child: _ColH('결과', align: TextAlign.right)),
                            Expanded(
                                flex: 4, child: _ColH('참고치 (단위)')),
                            SizedBox(width: 30, child: _ColH('Flag')),
                          ],
                        ),
                      ),
                      if (labSummary.isEmpty)
                        const Padding(
                          padding: EdgeInsets.all(16),
                          child: Text('검사 결과 없음',
                              style: TextStyle(
                                  fontSize: 11,
                                  color: AppColors.slate400)),
                        )
                      else
                        for (int i = 0; i < labSummary.length; i++)
                          _LabRow(
                              row: labSummary[i],
                              isLast: i == labSummary.length - 1),
                    ],
                  ),
                ),
              ],
            ),
          ),
          // 6시간 후 악화 예측
          if (prognosis6h != null) _PrognosisCard(prognosis: prognosis6h!),
          // 요약
          if (summary != null && summary!.isNotEmpty)
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
          _Footer(modal: 'LAB'),
        ],
      ),
    );
  }
}

Future<void> showLabClinicalSheet(
  BuildContext context, {
  required String patientName,
  required int age,
  required String sex,
  String? patientId,
  List<Map<String, dynamic>> labSummary = const [],
  Map<String, dynamic>? prognosis6h,
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
          title: const Text('혈액 검사 결과지',
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
            child: LabClinicalSheet(
              patientName: patientName,
              age: age,
              sex: sex,
              patientId: patientId,
              labSummary: labSummary,
              prognosis6h: prognosis6h,
              summary: summary,
              riskLevel: riskLevel,
            ),
          ),
        ),
      ),
    ),
  );
}

class _LabRow extends StatelessWidget {
  final Map<String, dynamic> row;
  final bool isLast;
  const _LabRow({required this.row, required this.isLast});

  @override
  Widget build(BuildContext context) {
    final name = (row['name'] ?? row['item'] ?? row['label'] ?? '—').toString();
    final value = (row['value'] ?? '—').toString();
    final unit = row['unit']?.toString();
    final ref = row['ref_range']?.toString() ?? row['reference']?.toString();
    final flag = row['flag']?.toString();
    final abnormal = flag != null && flag.isNotEmpty && flag != 'normal';
    final flagColor = (flag == 'H' || flag == 'HH' || flag == 'high')
        ? AppColors.critical
        : (flag == 'L' || flag == 'LL' || flag == 'low')
            ? const Color(0xFF2563EB)
            : AppColors.slate700;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
      decoration: BoxDecoration(
        border: isLast
            ? null
            : const Border(
                bottom: BorderSide(color: AppColors.slate100)),
      ),
      child: Row(
        children: [
          Expanded(
            flex: 5,
            child: Text(name,
                style: const TextStyle(
                    fontSize: 11, color: AppColors.slate800)),
          ),
          Expanded(
            flex: 3,
            child: Text(value,
                textAlign: TextAlign.right,
                style: TextStyle(
                    fontSize: 11,
                    fontFamily: 'monospace',
                    fontWeight: FontWeight.bold,
                    color: abnormal
                        ? AppColors.critical
                        : AppColors.slate900)),
          ),
          Expanded(
            flex: 4,
            child: Padding(
              padding: const EdgeInsets.only(left: 8),
              child: Text(
                ref != null
                    ? '$ref${unit != null ? " $unit" : ""}'
                    : (unit ?? ''),
                style: const TextStyle(
                    fontSize: 10,
                    color: AppColors.slate400,
                    fontFamily: 'monospace'),
              ),
            ),
          ),
          SizedBox(
            width: 30,
            child: Text(
              flag != null && flag.isNotEmpty ? flag : '',
              textAlign: TextAlign.center,
              style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.bold,
                  color: flagColor),
            ),
          ),
        ],
      ),
    );
  }
}

class _PrognosisCard extends StatelessWidget {
  final Map<String, dynamic> prognosis;
  const _PrognosisCard({required this.prognosis});

  @override
  Widget build(BuildContext context) {
    // prognosis_6h shape: {risk_score, hemoglobin_down, creatinine_up, ...}
    final risk = prognosis['risk_score'] as num?;
    final downs = <MapEntry<String, dynamic>>[];
    prognosis.forEach((k, v) {
      if (k == 'risk_score' || v == null || v == false) return;
      downs.add(MapEntry(k, v));
    });
    final isHigh = (risk ?? 0).toDouble() >= 0.5;

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 12),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: isHigh
            ? AppColors.critical.withAlpha(20)
            : AppColors.amber50,
        border: Border.all(
            color: isHigh
                ? AppColors.critical.withAlpha(150)
                : AppColors.amber300),
        borderRadius: BorderRadius.circular(4),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                isHigh ? Icons.warning_amber : Icons.trending_up,
                size: 16,
                color: isHigh ? AppColors.critical : AppColors.amber700,
              ),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  '6시간 후 악화 예측',
                  style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.bold,
                      color: isHigh
                          ? AppColors.critical
                          : AppColors.amber700),
                ),
              ),
              if (risk != null)
                Text(
                  '${(risk * 100).toStringAsFixed(0)}%',
                  style: TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.bold,
                      fontFamily: 'monospace',
                      color: isHigh
                          ? AppColors.critical
                          : AppColors.amber700),
                ),
            ],
          ),
          if (downs.isNotEmpty) ...[
            const SizedBox(height: 6),
            ...downs.take(5).map((e) => Padding(
                  padding: const EdgeInsets.only(top: 2),
                  child: Text('· ${_prognosisLabel(e.key)}',
                      style: const TextStyle(
                          fontSize: 11,
                          color: AppColors.slate700,
                          height: 1.4)),
                )),
          ],
        ],
      ),
    );
  }

  String _prognosisLabel(String key) {
    switch (key) {
      case 'hemoglobin_down':
        return '혈색소 감소 위험';
      case 'creatinine_up':
        return '크레아티닌 상승 위험';
      case 'potassium_abnormal':
        return '칼륨 이상 위험';
      case 'platelet_down':
        return '혈소판 감소 위험';
      case 'wbc_up':
        return '백혈구 상승 위험';
      default:
        return key;
    }
  }
}

// 공통 헬퍼 — cxr_clinical_sheet과 동일 구조
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

class _ColH extends StatelessWidget {
  final String text;
  final TextAlign align;
  const _ColH(this.text, {this.align = TextAlign.left});
  @override
  Widget build(BuildContext context) => Text(text,
      textAlign: align,
      style: const TextStyle(
          fontSize: 10,
          fontWeight: FontWeight.bold,
          color: AppColors.slate600));
}
