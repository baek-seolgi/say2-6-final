import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/reports_api.dart';
import '../../shared/theme/app_theme.dart';

/// frontend/src/pages/v2/ReportEditorPage.tsx 와 동일 흐름 — 모바일 적응.
/// 상단 4-stepper (초안 → 검토 → 서명 → EMR) + 소견서 본문 + 검토/서명 버튼.
class ReportEditorPage extends ConsumerStatefulWidget {
  final String encounterId;
  const ReportEditorPage({super.key, required this.encounterId});

  @override
  ConsumerState<ReportEditorPage> createState() =>
      _ReportEditorPageState();
}

class _ReportEditorPageState extends ConsumerState<ReportEditorPage> {
  late TextEditingController _editsController;
  final _signatureController = TextEditingController();
  bool _busy = false;
  bool _initializedEdits = false;

  @override
  void initState() {
    super.initState();
    _editsController = TextEditingController();
  }

  @override
  void dispose() {
    _editsController.dispose();
    _signatureController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(reportProvider(widget.encounterId));

    return Scaffold(
      backgroundColor: AppColors.slate50,
      appBar: AppBar(
        leading: IconButton(
            icon: const Icon(Icons.arrow_back, color: AppColors.slate700),
            onPressed: () =>
                context.go('/patient/${widget.encounterId}')),
        title: const Text('AI 종합소견 생성',
            style: TextStyle(
                fontSize: 17,
                fontWeight: FontWeight.bold,
                color: AppColors.slate900)),
      ),
      body: async.when(
        loading: () => const _LoadingPanel('AI 종합소견 생성 중…'),
        error: (e, _) => Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Text('소견서 로딩 실패: $e',
                style: const TextStyle(color: AppColors.critical)),
          ),
        ),
        data: (report) {
          // 초기 본문 세팅 (한 번만)
          if (!_initializedEdits) {
            _editsController.text =
                report.physicianEdits ?? report.aiDiagnosis ?? '';
            _initializedEdits = true;
          }
          final editable = report.status == 'reviewed';
          final canFinalize = editable &&
              _signatureController.text.trim().isNotEmpty &&
              !_busy;

          return Column(
            children: [
              Expanded(
                child: ListView(
                  padding: const EdgeInsets.all(12),
                  children: [
                    _StatusStepper(status: report.status),
                    const SizedBox(height: 12),
                    _AiBadge(riskLevel: report.aiRiskLevel),
                    const SizedBox(height: 8),
                    _ReportSheet(
                      controller: _editsController,
                      editable: editable,
                      status: report.status,
                      signature: _signatureController.text.trim(),
                    ),
                    const SizedBox(height: 12),
                    if (report.status == 'preliminary')
                      const _Hint(
                          '하단 "소견 검토" 버튼을 누르면 소견서 본문을 수정할 수 있습니다.'),
                    if (editable) ...[
                      _SignatureInput(
                        controller: _signatureController,
                        onChanged: (_) => setState(() {}),
                      ),
                      const SizedBox(height: 8),
                      const _Hint('서명 입력 후 아래 "소견 확정 · EMR 전송" 활성화'),
                    ],
                    if (report.status == 'signed')
                      const _SignedNotice(),
                  ],
                ),
              ),
              _ActionBar(
                status: report.status,
                canReview: report.status == 'preliminary' && !_busy,
                canFinalize: canFinalize,
                onReview: () => _doReview(report.id),
                onSign: () => _doSign(report.id),
              ),
            ],
          );
        },
      ),
    );
  }

  Future<void> _doReview(int reportId) async {
    setState(() => _busy = true);
    try {
      await reviewReport(ref, reportId,
          physicianEdits: _editsController.text,
          encounterId: widget.encounterId);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
            content: Text('검토 전이 실패: $e'),
            backgroundColor: AppColors.critical),
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _doSign(int reportId) async {
    setState(() => _busy = true);
    try {
      await signReport(
        ref,
        reportId,
        signedBy: _signatureController.text.trim(),
        physicianEdits: _editsController.text,
        encounterId: widget.encounterId,
      );
      if (!mounted) return;
      _showEmrDialog();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
            content: Text('서명 실패: $e'),
            backgroundColor: AppColors.critical),
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _showEmrDialog() {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(4)),
        title: Row(children: [
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(
                color: AppColors.emerald100,
                borderRadius: BorderRadius.circular(18)),
            child: const Icon(Icons.check_circle,
                color: AppColors.emerald600, size: 22),
          ),
          const SizedBox(width: 10),
          const Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('EMR 전송 완료',
                  style: TextStyle(
                      fontSize: 14, fontWeight: FontWeight.bold)),
              SizedBox(height: 2),
              Text('소견서 서명 · 외부 EMR 연동',
                  style: TextStyle(
                      fontSize: 10, color: AppColors.slate500)),
            ],
          ),
        ]),
        content: const Text(
          '소견서가 서명 완료 처리되었습니다.\n'
          'FHIR DiagnosticReport 상태가 final로 전이되어 외부 EMR로 전송되었습니다.',
          style: TextStyle(fontSize: 12, color: AppColors.slate700, height: 1.5),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('계속 보기'),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.brand600,
                foregroundColor: Colors.white),
            onPressed: () {
              Navigator.pop(ctx);
              context.go('/worklist');
            },
            child: const Text('환자 목록으로'),
          ),
        ],
      ),
    );
  }
}

// ────────────────────────────────────────────────────────────
// 상태 스테퍼 — 웹 STATUS_STEPS와 동일 (초안→검토→서명→EMR 전송)
// ────────────────────────────────────────────────────────────
class _StatusStepper extends StatelessWidget {
  final String status;
  const _StatusStepper({required this.status});

  static const _steps = ['초안', '검토', '서명', 'EMR 전송'];

  int get _stepIdx => switch (status) {
        'preliminary' => 0,
        'reviewed' => 1,
        'signed' => 3,
        'amended' => 3,
        _ => 0,
      };

  @override
  Widget build(BuildContext context) {
    return Row(
      children: List.generate(_steps.length * 2 - 1, (i) {
        if (i.isOdd) {
          // 구분자
          return const Text(' › ',
              style: TextStyle(
                  fontSize: 11,
                  color: AppColors.slate300,
                  fontWeight: FontWeight.bold));
        }
        final idx = i ~/ 2;
        final isPast = idx < _stepIdx;
        final isCurrent = idx == _stepIdx;
        final (bg, fg) = (isPast)
            ? (AppColors.slate200, AppColors.slate500)
            : isCurrent
                ? (
                    status == 'signed'
                        ? AppColors.emerald600
                        : status == 'reviewed'
                            ? const Color(0xFF2563EB)
                            : AppColors.amber600,
                    Colors.white,
                  )
                : (AppColors.slate100, AppColors.slate400);
        return Expanded(
          child: Container(
            padding:
                const EdgeInsets.symmetric(horizontal: 6, vertical: 5),
            decoration: BoxDecoration(
                color: bg,
                borderRadius: BorderRadius.circular(2)),
            child: Center(
              child: Text(
                '${idx + 1} ${_steps[idx]}',
                style: TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.bold,
                    color: fg),
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ),
        );
      }),
    );
  }
}

class _AiBadge extends StatelessWidget {
  final String? riskLevel;
  const _AiBadge({required this.riskLevel});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
          decoration: BoxDecoration(
            color: AppColors.aiBg,
            border: Border.all(color: AppColors.aiBorder),
            borderRadius: BorderRadius.circular(3),
          ),
          child: const Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.auto_awesome,
                  size: 10, color: AppColors.aiAccent),
              SizedBox(width: 4),
              Text('AI · Bedrock Claude',
                  style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.bold,
                      color: AppColors.aiAccent)),
            ],
          ),
        ),
        if (riskLevel != null) ...[
          const SizedBox(width: 6),
          Text('Risk: ${riskLevel!.toUpperCase()}',
              style: const TextStyle(
                  fontSize: 10, color: AppColors.slate500)),
        ],
      ],
    );
  }
}

// 소견서 양식 — 웹 ReportDocument를 단순화
class _ReportSheet extends StatelessWidget {
  final TextEditingController controller;
  final bool editable;
  final String status;
  final String signature;
  const _ReportSheet({
    required this.controller,
    required this.editable,
    required this.status,
    required this.signature,
  });

  @override
  Widget build(BuildContext context) {
    final today = DateTime.now();
    final dateStr = '${today.year}.${today.month}.${today.day}';
    final doctorName = status == 'signed'
        ? (signature.isEmpty ? '정OO' : signature)
        : status == 'reviewed'
            ? (signature.isEmpty ? '검토 중' : signature)
            : '—';

    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: AppColors.slate400),
        borderRadius: BorderRadius.circular(2),
      ),
      child: Column(
        children: [
          // 제목
          Container(
            padding: const EdgeInsets.symmetric(vertical: 12),
            decoration: const BoxDecoration(
              border: Border(
                  bottom: BorderSide(
                      color: AppColors.slate400, width: 2)),
            ),
            child: Column(
              children: const [
                Text('소 견 서',
                    style: TextStyle(
                        fontSize: 22,
                        fontWeight: FontWeight.bold,
                        letterSpacing: 8,
                        color: AppColors.slate900)),
                SizedBox(height: 4),
                Text('[ 원본대조필인 (印) ]',
                    style: TextStyle(
                        fontSize: 10, color: AppColors.critical)),
              ],
            ),
          ),
          // 향후 치료 의견 (편집 가능)
          Container(
            padding:
                const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
            decoration: const BoxDecoration(
              color: AppColors.slate100,
              border: Border(
                  bottom: BorderSide(color: AppColors.slate300)),
            ),
            child: Row(
              children: [
                const Text('향후 치료 의견',
                    style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.bold,
                        color: AppColors.slate700)),
                const SizedBox(width: 8),
                if (editable)
                  const Text('✎ 편집 모드',
                      style: TextStyle(
                          fontSize: 10,
                          color: AppColors.vunoCyanDim,
                          fontWeight: FontWeight.bold))
                else
                  const Text('읽기 전용 — 소견 검토 시 편집',
                      style: TextStyle(
                          fontSize: 10, color: AppColors.slate400)),
              ],
            ),
          ),
          editable
              // 편집 모드 — 원본 마크다운을 그대로 보여주고 의사가 수정 가능
              ? Padding(
                  padding: const EdgeInsets.all(10),
                  child: TextField(
                    controller: controller,
                    maxLines: 14,
                    style: const TextStyle(
                        fontSize: 12,
                        height: 1.5,
                        color: AppColors.slate800),
                    decoration: const InputDecoration(
                      border: InputBorder.none,
                      contentPadding: EdgeInsets.zero,
                      isDense: true,
                    ),
                  ),
                )
              // 읽기 모드 — Bedrock 출력의 마크다운(## 헤더, ** 굵게, > 인용 등) 정식 렌더링
              : Padding(
                  padding: const EdgeInsets.all(10),
                  child: controller.text.isEmpty
                      ? const Text('AI 종합 소견 생성 중…',
                          style: TextStyle(
                              fontSize: 12,
                              height: 1.5,
                              color: AppColors.slate800))
                      : MarkdownBody(
                          data: controller.text,
                          shrinkWrap: true,
                          styleSheet: MarkdownStyleSheet(
                            p: const TextStyle(
                                fontSize: 12,
                                height: 1.55,
                                color: AppColors.slate800),
                            h1: const TextStyle(
                                fontSize: 16,
                                height: 1.4,
                                fontWeight: FontWeight.bold,
                                color: AppColors.slate900),
                            h2: const TextStyle(
                                fontSize: 14,
                                height: 1.4,
                                fontWeight: FontWeight.bold,
                                color: AppColors.slate900),
                            h3: const TextStyle(
                                fontSize: 13,
                                height: 1.4,
                                fontWeight: FontWeight.bold,
                                color: AppColors.slate800),
                            strong: const TextStyle(
                                fontWeight: FontWeight.bold,
                                color: AppColors.slate900),
                            em: const TextStyle(
                                fontStyle: FontStyle.italic),
                            blockquote: const TextStyle(
                                fontSize: 11,
                                color: AppColors.slate600,
                                fontStyle: FontStyle.italic),
                            blockquoteDecoration: BoxDecoration(
                              color: AppColors.slate50,
                              border: const Border(
                                left: BorderSide(
                                    color: AppColors.vunoCyanDim, width: 3),
                              ),
                            ),
                            blockquotePadding: const EdgeInsets.symmetric(
                                horizontal: 8, vertical: 4),
                            listBullet: const TextStyle(
                                fontSize: 12, color: AppColors.slate800),
                            code: const TextStyle(
                                fontSize: 11,
                                fontFamily: 'monospace',
                                backgroundColor: AppColors.slate100),
                            horizontalRuleDecoration: const BoxDecoration(
                              border: Border(
                                top: BorderSide(color: AppColors.slate300),
                              ),
                            ),
                          ),
                        ),
                ),
          // 발행
          Container(
            padding: const EdgeInsets.all(14),
            decoration: const BoxDecoration(
              border: Border(
                  top: BorderSide(
                      color: AppColors.slate400, width: 2)),
            ),
            child: Column(
              children: [
                const Text('위 와 같 이 소 견 함',
                    style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.bold,
                        letterSpacing: 4,
                        color: AppColors.slate800)),
                const SizedBox(height: 12),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('발행일 $dateStr',
                            style: const TextStyle(
                                fontSize: 11,
                                color: AppColors.slate800)),
                        const Text('say-6 · 응급실 멀티모달 AI 진단 보조',
                            style: TextStyle(
                                fontSize: 9,
                                color: AppColors.slate400)),
                      ],
                    ),
                    Row(
                      children: [
                        Text('의사 $doctorName',
                            style: const TextStyle(
                                fontSize: 11,
                                fontWeight: FontWeight.bold,
                                color: AppColors.slate800)),
                        const SizedBox(width: 6),
                        Container(
                          width: 32,
                          height: 32,
                          alignment: Alignment.center,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            border: Border.all(
                              color: status == 'signed'
                                  ? AppColors.critical
                                  : AppColors.slate300,
                              width: 2,
                              style: status == 'signed'
                                  ? BorderStyle.solid
                                  : BorderStyle.none,
                            ),
                            color: Colors.transparent,
                          ),
                          child: Text(
                            '印',
                            style: TextStyle(
                                fontSize: 13,
                                fontWeight: FontWeight.bold,
                                color: status == 'signed'
                                    ? AppColors.critical
                                    : AppColors.slate300),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// 서명 입력 (검토 모드일 때만)
class _SignatureInput extends StatelessWidget {
  final TextEditingController controller;
  final ValueChanged<String> onChanged;
  const _SignatureInput(
      {required this.controller, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
          color: Colors.white,
          border: Border.all(color: AppColors.slate200),
          borderRadius: BorderRadius.circular(4)),
      child: Row(
        children: [
          const Icon(Icons.edit,
              size: 14, color: AppColors.slate400),
          const SizedBox(width: 8),
          Expanded(
            child: TextField(
              controller: controller,
              onChanged: onChanged,
              decoration: const InputDecoration(
                hintText: '담당 의사 성명 입력 (예: 정OO)',
                border: InputBorder.none,
                isDense: true,
                contentPadding: EdgeInsets.zero,
                hintStyle: TextStyle(
                    fontSize: 12, color: AppColors.slate400),
              ),
              style: const TextStyle(
                  fontSize: 12, color: AppColors.slate800),
            ),
          ),
        ],
      ),
    );
  }
}

class _ActionBar extends StatelessWidget {
  final String status;
  final bool canReview;
  final bool canFinalize;
  final VoidCallback onReview;
  final VoidCallback onSign;
  const _ActionBar({
    required this.status,
    required this.canReview,
    required this.canFinalize,
    required this.onReview,
    required this.onSign,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(top: BorderSide(color: AppColors.slate200)),
      ),
      child: Row(
        children: [
          Expanded(
            child: SizedBox(
              height: 44,
              child: OutlinedButton(
                style: OutlinedButton.styleFrom(
                  foregroundColor:
                      canReview ? AppColors.slate800 : AppColors.slate400,
                  side: BorderSide(
                      color: canReview
                          ? AppColors.slate400
                          : AppColors.slate200),
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(4)),
                ),
                onPressed: canReview ? onReview : null,
                child: const Text('소견 검토',
                    style: TextStyle(
                        fontSize: 13, fontWeight: FontWeight.bold)),
              ),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: SizedBox(
              height: 44,
              child: ElevatedButton(
                style: ElevatedButton.styleFrom(
                  backgroundColor: canFinalize
                      ? AppColors.slate900
                      : AppColors.slate200,
                  foregroundColor:
                      canFinalize ? Colors.white : AppColors.slate400,
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(4)),
                ),
                onPressed: canFinalize ? onSign : null,
                child: const Text('소견 확정 · EMR',
                    style: TextStyle(
                        fontSize: 13, fontWeight: FontWeight.bold)),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _SignedNotice extends StatelessWidget {
  const _SignedNotice();
  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(top: 8),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
          color: AppColors.emerald50,
          border: Border.all(color: AppColors.emerald300),
          borderRadius: BorderRadius.circular(4)),
      child: const Row(
        children: [
          Icon(Icons.check_circle,
              color: AppColors.emerald600, size: 16),
          SizedBox(width: 6),
          Text('서명 완료 · EMR 전송됨',
              style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.bold,
                  color: AppColors.emerald700)),
        ],
      ),
    );
  }
}

class _Hint extends StatelessWidget {
  final String text;
  const _Hint(this.text);
  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
          color: AppColors.slate50,
          border: Border.all(color: AppColors.slate200),
          borderRadius: BorderRadius.circular(3)),
      child: Text(text,
          style: const TextStyle(
              fontSize: 10, color: AppColors.slate600)),
    );
  }
}

class _LoadingPanel extends StatelessWidget {
  final String message;
  const _LoadingPanel(this.message);
  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const CircularProgressIndicator(strokeWidth: 2),
          const SizedBox(height: 12),
          Text(message,
              style: const TextStyle(
                  fontSize: 12, color: AppColors.slate500)),
        ],
      ),
    );
  }
}
