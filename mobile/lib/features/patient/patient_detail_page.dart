import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/patient_api.dart';
import '../../core/models/ai_rec.dart';
import '../../shared/theme/app_theme.dart';
import 'ecg_clinical_sheet.dart';

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
                          ),
                          const SizedBox(height: 10),
                        ],
                        // 의사 직접 오더 그룹
                        if (manualRecs.isNotEmpty) ...[
                          _ManualOrderGroup(
                              recs: manualRecs, encounterId: patientId),
                          const SizedBox(height: 10),
                        ],
                        // 모든 권고 완료 안내
                        if (allDone) const _AllDoneNotice(),
                      ],
                      const SizedBox(height: 12),
                      _ModalResultsSection(modalResults: data.modalResults),
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
  const _RankGroup(
      {required this.rank,
      required this.recs,
      required this.encounterId});

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
                  _RecCard(rec: recs[i], encounterId: encounterId),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// 의사 직접 오더 그룹 — slate 톤
class _ManualOrderGroup extends StatelessWidget {
  final List<AIRec> recs;
  final String encounterId;
  const _ManualOrderGroup(
      {required this.recs, required this.encounterId});

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
                      manual: true),
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
  const _RecCard({
    required this.rec,
    required this.encounterId,
    this.manual = false,
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

  // "검사결과지" 버튼 핸들러 — 현재는 ECG만 지원, CXR/LAB은 placeholder dialog
  void _openResultSheet(BuildContext context, String modality) {
    if (modality == 'ECG') {
      // TODO: 실제 환자 정보 + 측정값 전달. 일단 placeholder.
      showEcgClinicalSheet(
        context,
        patientName: '환자',
        age: 30,
        sex: 'M',
        patientId: widget.encounterId.substring(0, 8),
      );
    } else {
      showDialog(
        context: context,
        builder: (ctx) => AlertDialog(
          title: Text('$modality 검사결과지'),
          content: const Text('이 모달은 검사결과지 미구현 — 추후 추가 예정'),
          actions: [
            TextButton(
                onPressed: () => Navigator.pop(ctx),
                child: const Text('닫기')),
          ],
        ),
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

// 모달 결과 섹션
class _ModalResultsSection extends StatelessWidget {
  final Map<String, ModalSummary> modalResults;
  const _ModalResultsSection({required this.modalResults});

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
              Text('검사 결과 요약',
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
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                  color: Colors.white,
                  border: Border.all(color: AppColors.slate200),
                  borderRadius: BorderRadius.circular(4)),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
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
                  const SizedBox(width: 10),
                  Expanded(
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
