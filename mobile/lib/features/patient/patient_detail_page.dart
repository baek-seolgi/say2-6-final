import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

/// 환자 상세 — 향후 백엔드 연동으로 vitals/AI 권고/검사 결과 표시.
/// 현재는 placeholder로 라우팅 동작만 확인.
class PatientDetailPage extends ConsumerWidget {
  final String patientId;
  const PatientDetailPage({super.key, required this.patientId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      appBar: AppBar(
        title: Text('환자 $patientId',
            style:
                const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
        leading: IconButton(
            icon: const Icon(Icons.arrow_back),
            onPressed: () => context.go('/worklist')),
      ),
      body: const Padding(
        padding: EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _SectionTitle('AI 검사 권고'),
            _PlaceholderCard('1차 권고 — LAB · 승인 대기'),
            SizedBox(height: 12),
            _SectionTitle('검사 결과'),
            _PlaceholderCard('ECG 분석 중 · CXR 대기 · LAB 대기'),
            SizedBox(height: 12),
            _SectionTitle('활력징후'),
            _PlaceholderCard('HR 114 / BP 129·78 / SpO₂ 100 / T 36.6'),
            Spacer(),
            Text(
              'TODO: 백엔드 /encounters/:id/modal-results 연동 + AI 권고 승인 1탭',
              style: TextStyle(color: Colors.black54, fontSize: 11),
              textAlign: TextAlign.center,
            ),
          ],
        ),
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
      padding: const EdgeInsets.only(bottom: 6),
      child: Text(text,
          style: const TextStyle(fontSize: 13, fontWeight: FontWeight.bold)),
    );
  }
}

class _PlaceholderCard extends StatelessWidget {
  final String text;
  const _PlaceholderCard(this.text);
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
          color: Colors.white,
          border: Border.all(color: Colors.black12),
          borderRadius: BorderRadius.circular(6)),
      child: Text(text, style: const TextStyle(fontSize: 13)),
    );
  }
}
