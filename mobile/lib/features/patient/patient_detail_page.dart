import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/patient_api.dart';
import '../../core/models/ai_rec.dart';
import '../../shared/theme/app_theme.dart';

/// 환자 상세 — AI 권고 목록 + 모달 결과 요약 + 1탭 승인.
/// :id 는 라우터에서 encounter_id로 넘어옴.
class PatientDetailPage extends ConsumerWidget {
  final String patientId; // 실제로는 encounter_id
  const PatientDetailPage({super.key, required this.patientId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(patientDetailProvider(patientId));

    return Scaffold(
      appBar: AppBar(
        title: const Text('환자 상세',
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.go('/worklist'),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () => ref.invalidate(patientDetailProvider),
          ),
        ],
      ),
      body: async.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => _ErrorView(
          message: '$e',
          onRetry: () => ref.invalidate(patientDetailProvider),
        ),
        data: (data) => RefreshIndicator(
          onRefresh: () async => ref.invalidate(patientDetailProvider),
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              const _SectionTitle('🤖 AI 검사 권고'),
              if (data.recommendations.isEmpty)
                const _EmptyCard('아직 권고 없음 — 분석 진행 중')
              else
                ...data.recommendations
                    .map((r) => _RecCard(rec: r, encounterId: patientId)),
              const SizedBox(height: 16),
              const _SectionTitle('🔬 검사 결과 요약'),
              if (data.modalResults.isEmpty)
                const _EmptyCard('아직 완료된 검사 없음')
              else
                ...data.modalResults.values
                    .map((m) => _ModalSummaryCard(summary: m)),
            ],
          ),
        ),
      ),
    );
  }
}

class _RecCard extends ConsumerStatefulWidget {
  final AIRec rec;
  final String encounterId;
  const _RecCard({required this.rec, required this.encounterId});

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
          backgroundColor: AppColors.normal,
          duration: const Duration(seconds: 2),
        ),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
            content: Text('승인 실패: $e'),
            backgroundColor: AppColors.risk),
      );
    } finally {
      if (mounted) setState(() => _approving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final r = widget.rec;
    final (statusLabel, statusColor) = switch (r.status) {
      'completed' => ('✓ 완료', AppColors.normal),
      'active' => ('분석 중', AppColors.warning),
      'draft' => ('승인 대기', AppColors.vunoCyanDim),
      _ => (r.status, Colors.black54),
    };

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(
            color: r.isManual
                ? Colors.black26
                : AppColors.vunoCyan.withAlpha(80)),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                color: r.isManual ? Colors.black87 : AppColors.vunoBg,
                child: Text(
                  '${r.isManual ? "의사" : "AI"} · ${r.modality}',
                  style: const TextStyle(
                      color: Colors.white,
                      fontSize: 11,
                      fontWeight: FontWeight.bold),
                ),
              ),
              const Spacer(),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                    color: statusColor.withAlpha(30),
                    borderRadius: BorderRadius.circular(4)),
                child: Text(statusLabel,
                    style: TextStyle(
                        color: statusColor,
                        fontSize: 11,
                        fontWeight: FontWeight.bold)),
              ),
            ],
          ),
          if (r.reason.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(r.reason,
                style:
                    const TextStyle(fontSize: 12, color: Colors.black87)),
          ],
          if (r.isDraft) ...[
            const SizedBox(height: 10),
            SizedBox(
              width: double.infinity,
              height: 38,
              child: ElevatedButton.icon(
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.vunoBg,
                  foregroundColor: Colors.white,
                ),
                icon: _approving
                    ? const SizedBox(
                        width: 14,
                        height: 14,
                        child: CircularProgressIndicator(
                            strokeWidth: 2, color: Colors.white),
                      )
                    : const Icon(Icons.check, size: 16),
                label: Text(_approving ? '승인 중…' : '승인하고 검사 실행'),
                onPressed: _approving ? null : _approve,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _ModalSummaryCard extends StatelessWidget {
  final ModalSummary summary;
  const _ModalSummaryCard({required this.summary});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: Colors.black12),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            color: summary.isDone ? AppColors.normal : Colors.black54,
            child: Text(summary.modality,
                style: const TextStyle(
                    color: Colors.white,
                    fontSize: 11,
                    fontWeight: FontWeight.bold)),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              summary.summary ?? '결과 없음',
              style: const TextStyle(fontSize: 12, height: 1.4),
            ),
          ),
        ],
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  final String text;
  const _SectionTitle(this.text);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8, top: 4),
      child: Text(text,
          style:
              const TextStyle(fontSize: 14, fontWeight: FontWeight.bold)),
    );
  }
}

class _EmptyCard extends StatelessWidget {
  final String text;
  const _EmptyCard(this.text);

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.black.withAlpha(8),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(text,
          style: const TextStyle(fontSize: 12, color: Colors.black54)),
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
            const Icon(Icons.cloud_off, size: 48, color: Colors.black26),
            const SizedBox(height: 12),
            const Text('데이터 로딩 실패',
                style: TextStyle(fontWeight: FontWeight.bold)),
            const SizedBox(height: 4),
            Text(message,
                style:
                    const TextStyle(fontSize: 11, color: Colors.black54),
                textAlign: TextAlign.center),
            const SizedBox(height: 16),
            OutlinedButton(onPressed: onRetry, child: const Text('재시도')),
          ],
        ),
      ),
    );
  }
}
