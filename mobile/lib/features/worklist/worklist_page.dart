import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/encounters_api.dart';
import '../../core/models/encounter.dart';
import '../../shared/theme/app_theme.dart';
import '../../shared/widgets/ktas_badge.dart';

/// frontend/src/pages/v2/WorklistPage.tsx의 환자 행 디자인을 모바일 카드로 적응.
/// 헤더: 흰 배경 + slate-200 border-bottom. 카드: 흰 배경 + slate-300 border.
/// 행 클릭 → /patient/:id (AI 분석)
class WorklistPage extends ConsumerWidget {
  const WorklistPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(encountersListProvider('active'));

    return Scaffold(
      backgroundColor: AppColors.slate50,
      appBar: AppBar(
        title: Row(
          children: [
            const Text('환자 목록',
                style: TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.bold,
                    color: AppColors.slate900)),
            const SizedBox(width: 8),
            async.maybeWhen(
              data: (l) => Text(
                'Total ${l.length}명',
                style: const TextStyle(
                    fontSize: 11, color: AppColors.slate400),
              ),
              orElse: () => const SizedBox.shrink(),
            ),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh, color: AppColors.slate600),
            onPressed: () => ref.invalidate(encountersListProvider),
          ),
        ],
      ),
      body: async.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => _ErrorView(
          message: '$e',
          onRetry: () => ref.invalidate(encountersListProvider),
        ),
        data: (list) {
          if (list.isEmpty) {
            return const Center(
              child: Padding(
                padding: EdgeInsets.all(40),
                child: Text('조건에 맞는 환자가 없습니다.',
                    style: TextStyle(color: AppColors.slate400)),
              ),
            );
          }
          return RefreshIndicator(
            onRefresh: () async => ref.invalidate(encountersListProvider),
            child: ListView.separated(
              padding: const EdgeInsets.all(12),
              itemCount: list.length,
              separatorBuilder: (_, _) => const SizedBox(height: 8),
              itemBuilder: (context, i) {
                final e = list[i];
                return _PatientCard(
                  encounter: e,
                  index: i + 1,
                  onTap: () => context.go('/patient/${e.encounterId}'),
                );
              },
            ),
          );
        },
      ),
    );
  }
}

class _PatientCard extends StatelessWidget {
  final Encounter encounter;
  final int index;
  final VoidCallback onTap;
  const _PatientCard(
      {required this.encounter,
      required this.index,
      required this.onTap});

  // backend에 KTAS 없어서 ai_risk_level로 매핑 (임시):
  // critical → 2 (긴급), urgent → 3 (응급), routine → 4 (준응급), null → 5
  int _deriveKtas() {
    switch (encounter.aiRiskLevel) {
      case 'critical':
        return 2;
      case 'urgent':
        return 3;
      case 'routine':
        return 4;
      default:
        return 5;
    }
  }

  @override
  Widget build(BuildContext context) {
    final ktas = _deriveKtas();
    final regNo = encounter.subjectId ??
        encounter.encounterId.substring(0, 8); // MIMIC subject_id 우선

    return Material(
      color: Colors.white,
      shape: RoundedRectangleBorder(
        side: const BorderSide(color: AppColors.slate300),
        borderRadius: BorderRadius.circular(4),
      ),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(4),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Row 1: No. + 등록번호 + KTAS
              Row(
                children: [
                  Text(
                    '$index',
                    style: const TextStyle(
                        fontSize: 11,
                        color: AppColors.slate400,
                        fontFeatures: [FontFeature.tabularFigures()]),
                  ),
                  const SizedBox(width: 12),
                  Text(
                    regNo,
                    style: const TextStyle(
                      fontSize: 12,
                      color: AppColors.brand700,
                      decoration: TextDecoration.underline,
                      fontFeatures: [FontFeature.tabularFigures()],
                    ),
                  ),
                  const Spacer(),
                  KtasBadge(level: ktas),
                ],
              ),
              const SizedBox(height: 8),
              // Row 2: 환자명 + 나이/성별
              Row(
                crossAxisAlignment: CrossAxisAlignment.baseline,
                textBaseline: TextBaseline.alphabetic,
                children: [
                  Text(
                    encounter.patientName,
                    style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.bold,
                        color: AppColors.slate900),
                  ),
                  const SizedBox(width: 8),
                  if (encounter.patientAge != null)
                    Text(
                      '${encounter.patientAge}세 / ${_genderKo(encounter.patientGender)}',
                      style: const TextStyle(
                          fontSize: 12, color: AppColors.slate500),
                    ),
                ],
              ),
              const SizedBox(height: 6),
              // Row 3: 주증상
              Text(
                encounter.chiefComplaint ?? '주증상 미입력',
                style: const TextStyle(
                    fontSize: 12, color: AppColors.slate600, height: 1.4),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
              const SizedBox(height: 10),
              // Row 4: 등록시각 + 검사 상태 배지
              Row(
                children: [
                  Icon(Icons.access_time,
                      size: 11, color: AppColors.slate400),
                  const SizedBox(width: 4),
                  Text(
                    _fmtTime(encounter.startedAt),
                    style: const TextStyle(
                        fontSize: 11,
                        color: AppColors.slate500,
                        fontFeatures: [FontFeature.tabularFigures()]),
                  ),
                  const Spacer(),
                  _ExamStatusBadge(reportStatus: encounter.reportStatus),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  String _genderKo(String? g) =>
      g == 'male' ? '남' : g == 'female' ? '여' : '?';

  String _fmtTime(DateTime t) {
    final local = t.toLocal();
    final hh = local.hour.toString().padLeft(2, '0');
    final mm = local.minute.toString().padLeft(2, '0');
    return '${local.month}/${local.day} $hh:$mm';
  }
}

/// 웹 ExamStatusBadge와 동일 동작 — 4단계 (signed/done/inProgress/waiting)
/// 모바일에선 단순화: reportStatus 기반.
class _ExamStatusBadge extends StatelessWidget {
  final String? reportStatus;
  const _ExamStatusBadge({required this.reportStatus});

  @override
  Widget build(BuildContext context) {
    final (label, bg, border, fg) = switch (reportStatus) {
      'signed' || 'amended' => (
        '✓ 서명 완료',
        AppColors.emerald100,
        AppColors.emerald400,
        AppColors.emerald700,
      ),
      'reviewed' => (
        '검토 중',
        AppColors.purple50,
        AppColors.purple300,
        AppColors.purple700,
      ),
      'preliminary' => (
        '✓ 검사 완료',
        AppColors.emerald50,
        AppColors.emerald300,
        AppColors.emerald700,
      ),
      _ => (
        '분석 중',
        AppColors.amber100,
        AppColors.amber400,
        AppColors.amber700,
      ),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: bg,
        border: Border.all(color: border),
        borderRadius: BorderRadius.circular(2),
      ),
      child: Text(
        label,
        style: TextStyle(
            color: fg, fontSize: 11, fontWeight: FontWeight.bold),
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
            const Text('백엔드 연결 실패',
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
