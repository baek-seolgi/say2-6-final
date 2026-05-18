import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/patient_api.dart';
import '../../core/models/ai_rec.dart';
import '../../shared/theme/app_theme.dart';
import 'cxr_clinical_sheet.dart';
import 'ecg_clinical_sheet.dart';
import 'lab_clinical_sheet.dart';

/// frontend/src/pages/v2/PatientDetailPage.tsx의 AIRecPanel(가운데 컬럼)을 모바일에 맞춤.
/// 헤더(AI 검사 권고) + 진행 요약 + 1·2·3차 권고 그룹 + 의사 직접 오더 그룹
/// + 모든 권고 완료 안내 + footer "종합 소견서 생성" 버튼.
class PatientDetailPage extends ConsumerWidget {
  final String patientId; // encounter_id
  const PatientDetailPage({super.key, required this.patientId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(patientDetailProvider(patientId));

    return Scaffold(
      backgroundColor: AppColors.slate50,
      appBar: AppBar(
        leading: IconButton(
            icon: const Icon(Icons.arrow_back, color: AppColors.slate700),
            onPressed: () => context.go('/worklist')),
        title: const Text('AI 분석',
            style: TextStyle(
                fontSize: 17,
                fontWeight: FontWeight.bold,
                color: AppColors.slate900)),
        actions: [
          IconButton(
              icon: const Icon(Icons.refresh, color: AppColors.slate600),
              onPressed: () => ref.invalidate(patientDetailProvider)),
        ],
      ),
      body: async.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => _ErrorView(
          message: '$e',
          onRetry: () => ref.invalidate(patientDetailProvider),
        ),
        data: (data) {
          final aiRecs = data.recommendations.where((r) => !r.isManual).toList();
          final manualRecs =
              data.recommendations.where((r) => r.isManual).toList();
          final allDraft = data.recommendations
              .where((r) => r.status == 'draft')
              .toList();
          final doneCount = data.recommendations
              .where((r) => r.status == 'completed')
              .length;
          final allDone = data.recommendations.isNotEmpty &&
              data.recommendations.every((r) => r.status == 'completed');

          // AI 권고 1·2·3차 그룹 — 시간 클러스터링 (5초 이상 갭마다 차수+1)
          final byRank = <int, List<AIRec>>{};
          int rank = 1;
          DateTime? prev;
          for (final r in aiRecs) {
            if (prev != null && r.authoredOn.difference(prev).inSeconds > 5) {
              rank = (rank + 1).clamp(1, 3);
            }
            byRank.putIfAbsent(rank, () => []).add(r);
            prev = r.authoredOn;
          }
          final ranks = byRank.keys.toList()..sort();

          return Column(
            children: [
              Expanded(
                child: RefreshIndicator(
                  onRefresh: () async =>
                      ref.invalidate(patientDetailProvider),
                  child: ListView(
                    padding: const EdgeInsets.all(12),
                    children: [
                      const _PanelHeader(),
                      const SizedBox(height: 10),
                      if (data.recommendations.isEmpty)
                        const _LoadingCard()
                      else ...[
                        _ProgressSummary(
                          totalAi: aiRecs.length,
                          totalManual: manualRecs.length,
                          done: doneCount,
                          draft: allDraft.length,
                          onApproveAll: allDraft.isEmpty
                              ? null
                              : () async {
                                  for (final r in allDraft) {
                                    await approveOrder(
                                        ref, r.srId, patientId);
                                  }
                                },
                        ),
                        const SizedBox(height: 10),
                        // AI 1·2·3차 권고
                        for (final r in ranks) ...[
                          _RankGroup(
                            rank: r,
                            recs: byRank[r]!,
                            encounterId: patientId,
                            modalResults: data.modalResults,
                            patient: data.patient,
                          ),
                          const SizedBox(height: 10),
                        ],
                        // 의사 직접 오더 그룹
                        if (manualRecs.isNotEmpty) ...[
                          _ManualOrderGroup(
                            recs: manualRecs,
                            encounterId: patientId,
                            modalResults: data.modalResults,
                            patient: data.patient,
                          ),
                          const SizedBox(height: 10),
                        ],
                        // 모든 권고 완료 안내
                        if (allDone) const _AllDoneNotice(),
                      ],
                      const SizedBox(height: 12),
                      // 검사 직접 오더 — ECG/CXR/LAB 3개 버튼 (AI 권고와 무관)
                      _DirectOrderPanel(
                        encounterId: patientId,
                        patient: data.patient,
                        recommendations: data.recommendations,
                        modalResults: data.modalResults,
                      ),
                      const SizedBox(height: 12),
                      _ModalResultsSection(
                        modalResults: data.modalResults,
                        patient: data.patient,
                      ),
                    ],
                  ),
                ),
              ),
              _PanelFooter(
                disabled: !allDone,
                onOpenReport: () =>
                    context.go('/patient/$patientId/report'),
              ),
            ],
          );
        },
      ),
    );
  }
}

// ────────────────────────────────────────────────────────────
// 패널 헤더 — 웹 PanelHeader: brand-50 bg + sparkles 아이콘
// ────────────────────────────────────────────────────────────
class _PanelHeader extends StatelessWidget {
  const _PanelHeader();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: AppColors.brand50,
        border: Border.all(color: AppColors.brand200),
        borderRadius: BorderRadius.circular(4),
      ),
      child: Row(
        children: [
          const Icon(Icons.auto_awesome,
              color: AppColors.brand600, size: 20),
          const SizedBox(width: 8),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'AI 검사 권고',
                style: TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.bold,
                    color: AppColors.slate900),
              ),
              const SizedBox(height: 2),
              Text(
                'AI RECOMMENDATIONS · 1·2·3차',
                style: TextStyle(
                  fontSize: 9,
                  color: AppColors.slate400,
                  letterSpacing: 1.2,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

// 진행 요약 + 모두 승인 버튼 — 웹과 동일
class _ProgressSummary extends StatelessWidget {
  final int totalAi;
  final int totalManual;
  final int done;
  final int draft;
  final VoidCallback? onApproveAll;
  const _ProgressSummary({
    required this.totalAi,
    required this.totalManual,
    required this.done,
    required this.draft,
    required this.onApproveAll,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: AppColors.slate50,
        border: Border.all(color: AppColors.slate200),
        borderRadius: BorderRadius.circular(4),
      ),
      child: Row(
        children: [
          Expanded(
            child: DefaultTextStyle(
              style: const TextStyle(fontSize: 11, color: AppColors.slate600),
              child: Wrap(
                spacing: 4,
                children: [
                  Text.rich(TextSpan(children: [
                    const TextSpan(text: 'AI '),
                    TextSpan(
                      text: '$totalAi',
                      style: const TextStyle(
                          fontWeight: FontWeight.bold,
                          color: AppColors.slate900),
                    ),
                    const TextSpan(text: ' · 의사 '),
                    TextSpan(
                      text: '$totalManual',
                      style: const TextStyle(
                          fontWeight: FontWeight.bold,
                          color: AppColors.slate900),
                    ),
                    const TextSpan(text: ' · 완료 '),
                    TextSpan(
                      text: '$done',
                      style: const TextStyle(
                          fontWeight: FontWeight.bold,
                          color: AppColors.emerald600),
                    ),
                    const TextSpan(text: ' · 미승인 '),
                    TextSpan(
                      text: '$draft',
                      style: const TextStyle(
                          fontWeight: FontWeight.bold,
                          color: AppColors.purple600),
                    ),
                  ])),
                ],
              ),
            ),
          ),
          if (onApproveAll != null)
            SizedBox(
              height: 28,
              child: ElevatedButton(
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.brand600,
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(horizontal: 10),
                  minimumSize: Size.zero,
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(4)),
                ),
                onPressed: onApproveAll,
                child: Text(
                  '모두 승인 ($draft)',
                  style: const TextStyle(
                      fontSize: 11, fontWeight: FontWeight.bold),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

// AI 1·2·3차 권고 그룹 — 웹 RANK_META 색상
class _RankGroup extends StatelessWidget {
  final int rank;
  final List<AIRec> recs;
  final String encounterId;
  final Map<String, ModalSummary> modalResults;
  final PatientInfo patient;
  const _RankGroup({
    required this.rank,
    required this.recs,
    required this.encounterId,
    required this.modalResults,
    required this.patient,
  });

  @override
  Widget build(BuildContext context) {
    final meta = RankMeta.of(rank);
    return Container(
      decoration: BoxDecoration(
        color: meta.barBg,
        border: Border.all(color: meta.barBorder),
        borderRadius: BorderRadius.circular(4),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // 그룹 헤더
          Container(
            padding:
                const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            decoration: const BoxDecoration(
              border: Border(
                  bottom: BorderSide(color: Color(0x14000000))),
            ),
            child: Row(
              children: [
                const Icon(Icons.auto_awesome,
                    size: 12, color: AppColors.brand600),
                const SizedBox(width: 6),
                Container(
                  padding: const EdgeInsets.symmetric(
                      horizontal: 8, vertical: 2),
                  decoration: BoxDecoration(
                    color: meta.badgeBg,
                    borderRadius: BorderRadius.circular(2),
                  ),
                  child: Text(
                    meta.label,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 11,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Text(
                  'AI 분석 기반 · 검사 ${recs.length}건',
                  style: const TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w500,
                      color: AppColors.slate500),
                ),
              ],
            ),
          ),
          // 권고 카드들
          Container(
            color: Colors.white,
            padding: const EdgeInsets.all(10),
            child: Column(
              children: [
                for (int i = 0; i < recs.length; i++) ...[
                  if (i > 0) const SizedBox(height: 8),
                  _RecCard(
                    rec: recs[i],
                    encounterId: encounterId,
                    patient: patient,
                    modal: modalResults[recs[i].modality],
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// 검사 직접 오더 패널 — ECG / CXR / LAB 3개 버튼 항상 표시
// 웹 PatientDetailPage.tsx 의 ManualOrderPanel 과 동일 디자인.
// AI 권고와 무관하게 의사가 즉시 모달 실행 트리거 가능.
class _DirectOrderPanel extends ConsumerStatefulWidget {
  final String encounterId;
  final PatientInfo patient;
  final List<AIRec> recommendations;
  final Map<String, ModalSummary> modalResults;
  const _DirectOrderPanel({
    required this.encounterId,
    required this.patient,
    required this.recommendations,
    required this.modalResults,
  });

  @override
  ConsumerState<_DirectOrderPanel> createState() => _DirectOrderPanelState();
}

class _DirectOrderPanelState extends ConsumerState<_DirectOrderPanel> {
  final Set<String> _requesting = {}; // 5초간 로딩 표시용
  final Set<String> _requested = {};  // 클릭 즉시 영구 마킹

  Future<void> _request(String modality) async {
    setState(() {
      _requested.add(modality);
      _requesting.add(modality);
    });
    try {
      await requestOrder(
        ref,
        encounterId: widget.encounterId,
        patientId: widget.patient.subjectId ?? widget.encounterId,
        modality: modality,
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('$modality 직접 오더 — 분석 시작'),
          backgroundColor: AppColors.slate800,
          duration: const Duration(seconds: 2),
        ),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('오더 실패: $e'), backgroundColor: AppColors.critical),
      );
      setState(() => _requested.remove(modality));
    } finally {
      if (mounted) {
        Future.delayed(const Duration(seconds: 5), () {
          if (mounted) setState(() => _requesting.remove(modality));
        });
      }
    }
  }

  // 해당 modality가 이미 AI 권고 또는 의사 오더에 들어있는지
  bool _isAlreadyOrdered(String modality) {
    if (_requested.contains(modality)) return true;
    return widget.recommendations.any((r) => r.modality == modality);
  }

  @override
  Widget build(BuildContext context) {
    const all = ['ECG', 'CXR', 'LAB'];
    return Container(
      decoration: BoxDecoration(
        color: AppColors.slate50,
        border: Border.all(color: AppColors.slate300),
        borderRadius: BorderRadius.circular(4),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            decoration: const BoxDecoration(
              border: Border(bottom: BorderSide(color: AppColors.slate200)),
            ),
            child: const Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('검사 직접 오더',
                    style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.bold,
                        color: AppColors.slate800)),
                SizedBox(height: 2),
                Text('AI 권고 외 검사를 의사가 직접 지시',
                    style: TextStyle(fontSize: 10, color: AppColors.slate500)),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(10),
            child: Row(
              children: [
                for (final m in all) ...[
                  if (m != all.first) const SizedBox(width: 8),
                  Expanded(child: _buildBtn(m)),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildBtn(String modality) {
    final already = _isAlreadyOrdered(modality);
    final loading = _requesting.contains(modality);

    final IconData icon = switch (modality) {
      'ECG' => Icons.monitor_heart_outlined,
      'CXR' => Icons.image_outlined,
      _ => Icons.science_outlined,
    };

    final String label = switch (modality) {
      'ECG' => 'ECG',
      'CXR' => 'CXR',
      _ => 'LAB',
    };

    final Color bg;
    final Color fg;
    final Color border;
    final String hint;
    if (already) {
      bg = AppColors.slate100;
      fg = AppColors.slate400;
      border = AppColors.slate200;
      hint = '오더됨';
    } else if (loading) {
      bg = AppColors.amber50;
      fg = AppColors.amber700;
      border = AppColors.amber300;
      hint = '요청 중';
    } else {
      bg = Colors.white;
      fg = AppColors.slate700;
      border = AppColors.slate400;
      hint = '직접 오더';
    }

    return InkWell(
      onTap: (already || loading) ? null : () => _request(modality),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 10),
        decoration: BoxDecoration(
          color: bg,
          border: Border.all(color: border),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (loading)
              const SizedBox(
                width: 16,
                height: 16,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: AppColors.amber700,
                ),
              )
            else
              Icon(icon, size: 16, color: fg),
            const SizedBox(height: 4),
            Text(label,
                style: TextStyle(
                    fontSize: 11, fontWeight: FontWeight.bold, color: fg)),
            const SizedBox(height: 2),
            Text(hint,
                style: TextStyle(
                    fontSize: 9, color: fg.withAlpha(180))),
          ],
        ),
      ),
    );
  }
}

// 의사 직접 오더 그룹 — slate 톤 (이미 만들어진 manual SR 카드 — _DirectOrderPanel과는 별개)
class _ManualOrderGroup extends StatelessWidget {
  final List<AIRec> recs;
  final String encounterId;
  final Map<String, ModalSummary> modalResults;
  final PatientInfo patient;
  const _ManualOrderGroup({
    required this.recs,
    required this.encounterId,
    required this.modalResults,
    required this.patient,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.slate50,
        border: Border.all(color: AppColors.slate400),
        borderRadius: BorderRadius.circular(4),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding:
                const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            decoration: const BoxDecoration(
              color: AppColors.slate100,
              border: Border(
                  bottom: BorderSide(color: AppColors.slate300)),
            ),
            child: Row(
              children: [
                const Icon(Icons.medical_services,
                    size: 14, color: AppColors.slate700),
                const SizedBox(width: 6),
                Container(
                  padding: const EdgeInsets.symmetric(
                      horizontal: 8, vertical: 2),
                  decoration: BoxDecoration(
                      color: AppColors.slate700,
                      borderRadius: BorderRadius.circular(2)),
                  child: const Text(
                    '의사 직접 오더',
                    style: TextStyle(
                        color: Colors.white,
                        fontSize: 11,
                        fontWeight: FontWeight.bold),
                  ),
                ),
                const SizedBox(width: 8),
                Text('AI 권고와 무관 · 의사 판단 · 검사 ${recs.length}건',
                    style: const TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w500,
                        color: AppColors.slate500)),
              ],
            ),
          ),
          Container(
            color: Colors.white,
            padding: const EdgeInsets.all(10),
            child: Column(
              children: [
                for (int i = 0; i < recs.length; i++) ...[
                  if (i > 0) const SizedBox(height: 8),
                  _RecCard(
                    rec: recs[i],
                    encounterId: encounterId,
                    manual: true,
                    patient: patient,
                    modal: modalResults[recs[i].modality],
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// 개별 권고 카드 — 웹 RecRow와 동일 디자인
class _RecCard extends ConsumerStatefulWidget {
  final AIRec rec;
  final String encounterId;
  final bool manual;
  final ModalSummary? modal; // 해당 모달의 raw 결과 (검사결과지 버튼이 사용)
  final PatientInfo patient; // 인적사항 + subject_id (검사결과지 헤더 + CXR 이미지용)
  const _RecCard({
    required this.rec,
    required this.encounterId,
    required this.patient,
    this.manual = false,
    this.modal,
  });

  @override
  ConsumerState<_RecCard> createState() => _RecCardState();
}

class _RecCardState extends ConsumerState<_RecCard> {
  bool _approving = false;

  Future<void> _approve() async {
    setState(() => _approving = true);
    try {
      await approveOrder(ref, widget.rec.srId, widget.encounterId);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('${widget.rec.modality} 검사 승인 — 분석 시작'),
          backgroundColor: AppColors.emerald600,
          duration: const Duration(seconds: 2),
        ),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
            content: Text('승인 실패: $e'),
            backgroundColor: AppColors.critical),
      );
    } finally {
      if (mounted) setState(() => _approving = false);
    }
  }

  // "검사결과지" 버튼 핸들러 — modality별로 실 데이터 + 환자 인적사항 전달.
  void _openResultSheet(BuildContext context, String modality) {
    final modal = widget.modal;
    final p = widget.patient;
    final patientName = p.name ?? '환자';
    final age = p.age ?? 0;
    final sex = p.sex;
    // 차트 헤더용 ID — subject_id 우선, 없으면 encounter UUID 앞 8자리
    final patientId = p.subjectId ?? widget.encounterId.substring(0, 8);

    if (modality == 'ECG') {
      showEcgClinicalSheet(
        context,
        patientName: patientName,
        age: age,
        sex: sex,
        patientId: patientId,
        waveform: modal?.ecgWaveform,
        ecgVitals: modal?.ecgVitals,
        findings: modal?.findings ?? const [],
      );
    } else if (modality == 'CXR') {
      showCxrClinicalSheet(
        context,
        patientName: patientName,
        age: age,
        sex: sex,
        patientId: patientId,
        subjectId: p.subjectId, // ⭐ 실 subject_id 전달 → /assets/cxr/{id} 이미지 로드
        measurements: modal?.cxrMeasurements,
        metadata: modal?.cxrMetadata,
        findingsText: modal?.cxrFindingsText ?? const [],
        impression: modal?.cxrImpression,
        summary: modal?.summary,
        riskLevel: modal?.riskLevel,
      );
    } else if (modality == 'LAB') {
      showLabClinicalSheet(
        context,
        patientName: patientName,
        age: age,
        sex: sex,
        patientId: patientId,
        labSummary: modal?.labSummary ?? const [],
        prognosis6h: modal?.prognosis6h,
        summary: modal?.summary,
        riskLevel: modal?.riskLevel,
      );
    }
  }

  IconData _icon(String m) => switch (m) {
        'ECG' => Icons.monitor_heart_outlined,
        'CXR' => Icons.image_outlined,
        _ => Icons.science_outlined,
      };

  String _label(String m) => switch (m) {
        'ECG' => '심전도 12-Lead',
        'CXR' => '흉부 X-ray',
        _ => '혈액 검사',
      };

  @override
  Widget build(BuildContext context) {
    final r = widget.rec;
    final isDone = r.isDone;
    final isRunning = _approving || r.isRunning;
    final isDraft = r.isDraft && !_approving;

    final (cardBg, cardBorder) = switch ((isDone, isRunning, widget.manual)) {
      (true, _, _) => (
        AppColors.emerald50.withAlpha(100),
        AppColors.emerald300.withAlpha(140),
      ),
      (_, true, _) => (
        AppColors.amber50.withAlpha(100),
        AppColors.amber300.withAlpha(140),
      ),
      (_, _, true) => (
        AppColors.slate50.withAlpha(160),
        AppColors.slate300,
      ),
      _ => (Colors.white, AppColors.slate200),
    };

    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: cardBg,
        border: Border.all(color: cardBorder),
        borderRadius: BorderRadius.circular(3),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 28,
                height: 28,
                decoration: BoxDecoration(
                  color: isDone
                      ? AppColors.emerald100
                      : isRunning
                          ? AppColors.amber100
                          : widget.manual
                              ? AppColors.slate200
                              : AppColors.slate100,
                ),
                child: Icon(
                  _icon(r.modality),
                  size: 14,
                  color: isDone
                      ? AppColors.emerald700
                      : isRunning
                          ? AppColors.amber700
                          : AppColors.slate600,
                ),
              ),
              const SizedBox(width: 8),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(r.modality,
                      style: const TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.bold,
                          color: AppColors.slate800,
                          height: 1)),
                  const SizedBox(height: 2),
                  Text(_label(r.modality),
                      style: const TextStyle(
                          fontSize: 9, color: AppColors.slate400)),
                ],
              ),
              const Spacer(),
              _RecStatusChip(isDone: isDone, isRunning: isRunning),
            ],
          ),
          if (r.reason.isNotEmpty) ...[
            const SizedBox(height: 6),
            Text(
              r.reason,
              style: const TextStyle(
                  fontSize: 10,
                  color: AppColors.slate500,
                  height: 1.4),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ],
          if (isDraft) ...[
            const SizedBox(height: 8),
            SizedBox(
              width: double.infinity,
              height: 32,
              child: ElevatedButton.icon(
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.slate800,
                  foregroundColor: Colors.white,
                  padding: EdgeInsets.zero,
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(2)),
                ),
                onPressed: _approve,
                icon: const Icon(Icons.check_circle, size: 14),
                label: const Text('승인하고 검사 실행',
                    style: TextStyle(
                        fontSize: 11, fontWeight: FontWeight.bold)),
              ),
            ),
          ],
          if (isDone) ...[
            const SizedBox(height: 8),
            SizedBox(
              width: double.infinity,
              height: 28,
              child: OutlinedButton.icon(
                style: OutlinedButton.styleFrom(
                  foregroundColor: AppColors.vunoCyanDim,
                  side: const BorderSide(color: AppColors.vunoCyanDim),
                  padding: EdgeInsets.zero,
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(2)),
                ),
                icon: const Icon(Icons.description_outlined, size: 12),
                label: const Text('검사결과지',
                    style: TextStyle(
                        fontSize: 10, fontWeight: FontWeight.bold)),
                onPressed: () => _openResultSheet(context, r.modality),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _RecStatusChip extends StatelessWidget {
  final bool isDone;
  final bool isRunning;
  const _RecStatusChip({required this.isDone, required this.isRunning});

  @override
  Widget build(BuildContext context) {
    final (label, bg, fg, icon) = isDone
        ? ('완료', AppColors.emerald100, AppColors.emerald700,
            Icons.check_circle)
        : isRunning
            ? ('분석 중', AppColors.amber100, AppColors.amber700,
                Icons.refresh)
            : ('승인 대기', AppColors.purple100, AppColors.purple700, null);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
          color: bg, borderRadius: BorderRadius.circular(2)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, size: 10, color: fg),
            const SizedBox(width: 3),
          ],
          Text(label,
              style: TextStyle(
                  color: fg,
                  fontSize: 10,
                  fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }
}

// 모든 권고 완료 안내
class _AllDoneNotice extends StatelessWidget {
  const _AllDoneNotice();
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.emerald50,
        border: Border.all(color: AppColors.emerald300),
        borderRadius: BorderRadius.circular(4),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.check_circle,
              color: AppColors.emerald600, size: 18),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: const [
                Text('모든 권장 검사 완료',
                    style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.bold,
                        color: AppColors.emerald800)),
                SizedBox(height: 2),
                Text(
                  'AI가 추가로 권고하는 검사가 없습니다. 종합 소견서를 생성할 수 있습니다.',
                  style: TextStyle(
                      fontSize: 11,
                      color: AppColors.emerald700,
                      height: 1.4),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// 모달 결과 섹션 — 완료된 각 모달마다 "검사결과지" 버튼 (풀시트 다이얼로그 열기)
// 웹 PatientDetailPage 검사결과 탭과 동일 패턴.
class _ModalResultsSection extends StatelessWidget {
  final Map<String, ModalSummary> modalResults;
  final PatientInfo patient;
  const _ModalResultsSection({
    required this.modalResults,
    required this.patient,
  });

  void _openSheet(BuildContext context, ModalSummary m) {
    final patientName = patient.name ?? '환자';
    final age = patient.age ?? 0;
    final sex = patient.sex;
    final patientId = patient.subjectId ?? '';

    if (m.modality == 'ECG') {
      showEcgClinicalSheet(
        context,
        patientName: patientName,
        age: age,
        sex: sex,
        patientId: patientId,
        waveform: m.ecgWaveform,
        ecgVitals: m.ecgVitals,
        findings: m.findings,
      );
    } else if (m.modality == 'CXR') {
      showCxrClinicalSheet(
        context,
        patientName: patientName,
        age: age,
        sex: sex,
        patientId: patientId,
        subjectId: patient.subjectId,
        measurements: m.cxrMeasurements,
        metadata: m.cxrMetadata,
        findingsText: m.cxrFindingsText,
        impression: m.cxrImpression,
        summary: m.summary,
        riskLevel: m.riskLevel,
      );
    } else if (m.modality == 'LAB') {
      showLabClinicalSheet(
        context,
        patientName: patientName,
        age: age,
        sex: sex,
        patientId: patientId,
        labSummary: m.labSummary,
        prognosis6h: m.prognosis6h,
        summary: m.summary,
        riskLevel: m.riskLevel,
      );
    }
  }

  IconData _icon(String modality) => switch (modality) {
        'ECG' => Icons.monitor_heart_outlined,
        'CXR' => Icons.image_outlined,
        _ => Icons.science_outlined,
      };

  String _label(String modality) => switch (modality) {
        'ECG' => '심전도 12-Lead',
        'CXR' => '흉부 X-ray',
        _ => '혈액 검사',
      };

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 6),
          child: Row(
            children: const [
              Icon(Icons.science_outlined,
                  size: 14, color: AppColors.slate600),
              SizedBox(width: 4),
              Text('검사 결과',
                  style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.bold,
                      color: AppColors.slate700)),
            ],
          ),
        ),
        if (modalResults.isEmpty)
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
                color: Colors.white,
                border: Border.all(color: AppColors.slate200),
                borderRadius: BorderRadius.circular(4)),
            child: const Text(
              '아직 완료된 검사 없음',
              style: TextStyle(fontSize: 11, color: AppColors.slate500),
            ),
          )
        else
          for (final m in modalResults.values) ...[
            Container(
              margin: const EdgeInsets.only(bottom: 8),
              decoration: BoxDecoration(
                  color: Colors.white,
                  border: Border.all(color: AppColors.slate200),
                  borderRadius: BorderRadius.circular(4)),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // 상단 — modality 뱃지 + 라벨 + 검사결과지 버튼
                  Padding(
                    padding: const EdgeInsets.fromLTRB(10, 10, 10, 6),
                    child: Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 6, vertical: 3),
                          color: m.isDone
                              ? AppColors.emerald600
                              : AppColors.slate500,
                          child: Text(m.modality,
                              style: const TextStyle(
                                  color: Colors.white,
                                  fontSize: 10,
                                  fontWeight: FontWeight.bold)),
                        ),
                        const SizedBox(width: 8),
                        Icon(_icon(m.modality),
                            size: 14, color: AppColors.slate600),
                        const SizedBox(width: 4),
                        Expanded(
                          child: Text(
                            _label(m.modality),
                            style: const TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.bold,
                                color: AppColors.slate800),
                          ),
                        ),
                        if (m.isDone)
                          TextButton.icon(
                            onPressed: () => _openSheet(context, m),
                            style: TextButton.styleFrom(
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 10, vertical: 4),
                              minimumSize: Size.zero,
                              tapTargetSize:
                                  MaterialTapTargetSize.shrinkWrap,
                              foregroundColor: AppColors.vunoCyanDim,
                              side: const BorderSide(
                                  color: AppColors.vunoCyanDim),
                              shape: const RoundedRectangleBorder(),
                            ),
                            icon: const Icon(Icons.description_outlined,
                                size: 12),
                            label: const Text('검사결과지',
                                style: TextStyle(
                                    fontSize: 10,
                                    fontWeight: FontWeight.bold)),
                          ),
                      ],
                    ),
                  ),
                  // 하단 — 한 줄 요약
                  Padding(
                    padding:
                        const EdgeInsets.fromLTRB(10, 0, 10, 10),
                    child: Text(
                      m.summary ?? '결과 없음',
                      style: const TextStyle(
                          fontSize: 11,
                          color: AppColors.slate700,
                          height: 1.4),
                    ),
                  ),
                ],
              ),
            ),
          ],
      ],
    );
  }
}

// 하단 "종합 소견서 생성" 버튼 — 웹 PanelFooter
class _PanelFooter extends StatelessWidget {
  final bool disabled;
  final VoidCallback onOpenReport;
  const _PanelFooter({required this.disabled, required this.onOpenReport});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(top: BorderSide(color: AppColors.slate200)),
      ),
      child: Column(
        children: [
          SizedBox(
            width: double.infinity,
            height: 46,
            child: ElevatedButton.icon(
              style: ElevatedButton.styleFrom(
                backgroundColor:
                    disabled ? AppColors.slate200 : AppColors.brand600,
                foregroundColor:
                    disabled ? AppColors.slate400 : Colors.white,
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(4)),
              ),
              onPressed: disabled ? null : onOpenReport,
              icon: const Icon(Icons.description_outlined, size: 16),
              label: Text(
                disabled ? '검사 진행 중 — 소견서 대기' : '종합 소견서 생성',
                style: const TextStyle(
                    fontSize: 13, fontWeight: FontWeight.bold),
              ),
            ),
          ),
          if (disabled) ...[
            const SizedBox(height: 6),
            SizedBox(
              width: double.infinity,
              height: 32,
              child: OutlinedButton(
                style: OutlinedButton.styleFrom(
                  foregroundColor: AppColors.slate600,
                  side: const BorderSide(color: AppColors.slate300),
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(4)),
                ),
                onPressed: onOpenReport,
                child: const Text('의사 직권으로 소견서 생성 →',
                    style: TextStyle(
                        fontSize: 11, fontWeight: FontWeight.bold)),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _LoadingCard extends StatelessWidget {
  const _LoadingCard();
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(24),
      alignment: Alignment.center,
      child: Column(
        children: const [
          CircularProgressIndicator(strokeWidth: 2),
          SizedBox(height: 10),
          Text('AI 권고를 불러오는 중…',
              style: TextStyle(fontSize: 11, color: AppColors.slate500)),
        ],
      ),
    );
  }
}

class _ErrorView extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;
  const _ErrorView({required this.message, required this.onRetry});
  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.cloud_off,
                size: 48, color: AppColors.slate300),
            const SizedBox(height: 12),
            const Text('데이터 로딩 실패',
                style: TextStyle(
                    fontWeight: FontWeight.bold,
                    color: AppColors.slate700)),
            const SizedBox(height: 4),
            Text(message,
                style: const TextStyle(
                    fontSize: 11, color: AppColors.slate500),
                textAlign: TextAlign.center),
            const SizedBox(height: 16),
            OutlinedButton(onPressed: onRetry, child: const Text('재시도')),
          ],
        ),
      ),
    );
  }
}
