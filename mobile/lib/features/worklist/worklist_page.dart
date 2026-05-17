import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/encounters_api.dart';
import '../../core/models/encounter.dart';
import '../../shared/theme/app_theme.dart';

/// 환자 목록 — 백엔드 /encounters/list 실시간 호출.
/// KTAS 정보는 backend에서 아직 안 내려와서 chief_complaint 기반 휴리스틱 placeholder.
class WorklistPage extends ConsumerWidget {
  const WorklistPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(encountersListProvider('active'));

    return Scaffold(
      appBar: AppBar(
        title: const Text('환자 목록',
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
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
              child: Text('활성 환자가 없습니다.',
                  style: TextStyle(color: Colors.black54)),
            );
          }
          return RefreshIndicator(
            onRefresh: () async => ref.invalidate(encountersListProvider),
            child: ListView.separated(
              itemCount: list.length,
              separatorBuilder: (_, _) => const Divider(height: 1),
              itemBuilder: (context, i) {
                final e = list[i];
                return _EncounterTile(
                  encounter: e,
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

class _EncounterTile extends StatelessWidget {
  final Encounter encounter;
  final VoidCallback onTap;
  const _EncounterTile({required this.encounter, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final risk = encounter.aiRiskLevel;
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            // Risk 컬러 사이드바 (4px) — AI 위험도 시각화
            Container(
              width: 4,
              height: 48,
              color: _riskColor(risk),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Text(encounter.patientName,
                          style: const TextStyle(
                              fontSize: 16, fontWeight: FontWeight.bold)),
                      const SizedBox(width: 6),
                      if (encounter.patientAge != null)
                        Text(
                          '${encounter.patientAge}세'
                          '${encounter.patientGender == 'male' ? '·남' : encounter.patientGender == 'female' ? '·여' : ''}',
                          style: const TextStyle(
                              fontSize: 12, color: Colors.black54),
                        ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(
                    encounter.chiefComplaint ?? '주증상 미입력',
                    style: const TextStyle(fontSize: 13),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 4),
                  Text(
                    _relativeTime(encounter.startedAt),
                    style:
                        const TextStyle(fontSize: 11, color: Colors.black45),
                  ),
                ],
              ),
            ),
            _StatusBadge(reportStatus: encounter.reportStatus),
            const Icon(Icons.chevron_right, color: Colors.black38),
          ],
        ),
      ),
    );
  }

  Color _riskColor(String? risk) {
    switch (risk) {
      case 'critical':
        return AppColors.ktas1;
      case 'urgent':
        return AppColors.ktas2;
      case 'routine':
        return AppColors.normal;
      default:
        return Colors.black12;
    }
  }

  String _relativeTime(DateTime t) {
    final diff = DateTime.now().toUtc().difference(t.toUtc());
    if (diff.inMinutes < 1) return '방금';
    if (diff.inMinutes < 60) return '${diff.inMinutes}분 전';
    if (diff.inHours < 24) return '${diff.inHours}시간 전';
    return '${diff.inDays}일 전';
  }
}

class _StatusBadge extends StatelessWidget {
  final String? reportStatus;
  const _StatusBadge({required this.reportStatus});

  @override
  Widget build(BuildContext context) {
    final (label, bg, fg) = switch (reportStatus) {
      'signed' => ('서명 완료', AppColors.normal.withAlpha(30), AppColors.normal),
      'reviewed' => ('검토 중', AppColors.warning.withAlpha(30), AppColors.warning),
      'preliminary' => ('소견 작성 가능',
        AppColors.vunoCyanDim.withAlpha(30),
        AppColors.vunoCyanDim),
      _ => ('분석 중', Colors.black12, Colors.black54),
    };
    return Container(
      margin: const EdgeInsets.only(right: 8),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
          color: bg, borderRadius: BorderRadius.circular(4)),
      child: Text(label,
          style: TextStyle(
              color: fg, fontSize: 11, fontWeight: FontWeight.bold)),
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
                size: 48, color: Colors.black26),
            const SizedBox(height: 12),
            const Text('백엔드 연결 실패',
                style: TextStyle(fontWeight: FontWeight.bold)),
            const SizedBox(height: 4),
            Text(message,
                style: const TextStyle(fontSize: 11, color: Colors.black54),
                textAlign: TextAlign.center),
            const SizedBox(height: 16),
            OutlinedButton(onPressed: onRetry, child: const Text('재시도')),
          ],
        ),
      ),
    );
  }
}
