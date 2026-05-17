import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../shared/theme/app_theme.dart';

/// 환자 목록 — 데모 데이터로 동작. 추후 백엔드 /encounters 호출로 교체.
class WorklistPage extends ConsumerWidget {
  const WorklistPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // 데모 환자 데이터 (백엔드 연동 전 placeholder)
    final patients = [
      _DemoPatient('원OO', 30, 2, '갑작스런 두근거림, 불규칙한 심박', '분석 중'),
      _DemoPatient('이OO', 67, 2, '흉통 30분', '검사 완료'),
      _DemoPatient('박OO', 54, 3, '두통, 메스꺼움', '검사 대기'),
      _DemoPatient('최OO', 78, 1, '의식 저하', '서명 완료'),
    ];

    return Scaffold(
      appBar: AppBar(
        title: const Text('환자 목록',
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
        actions: [
          IconButton(
              icon: const Icon(Icons.refresh),
              onPressed: () {/* TODO: 폴링 새로고침 */}),
        ],
      ),
      body: ListView.separated(
        itemCount: patients.length,
        separatorBuilder: (_, _) => const Divider(height: 1),
        itemBuilder: (context, i) {
          final p = patients[i];
          return _PatientTile(
            patient: p,
            onTap: () => context.go('/patient/$i'),
          );
        },
      ),
    );
  }
}

class _PatientTile extends StatelessWidget {
  final _DemoPatient patient;
  final VoidCallback onTap;
  const _PatientTile({required this.patient, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            // KTAS 배지
            Container(
              padding:
                  const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              color: _ktasColor(patient.ktas),
              child: Text('KTAS ${patient.ktas}',
                  style: const TextStyle(
                      color: Colors.white,
                      fontSize: 11,
                      fontWeight: FontWeight.bold)),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(patient.name,
                      style: const TextStyle(
                          fontSize: 16, fontWeight: FontWeight.bold)),
                  Text('${patient.age}세',
                      style: const TextStyle(
                          fontSize: 12, color: Colors.black54)),
                  const SizedBox(height: 4),
                  Text(patient.chief,
                      style: const TextStyle(fontSize: 13),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis),
                ],
              ),
            ),
            _StatusBadge(label: patient.status),
            const Icon(Icons.chevron_right, color: Colors.black38),
          ],
        ),
      ),
    );
  }

  Color _ktasColor(int k) {
    switch (k) {
      case 1:
        return AppColors.ktas1;
      case 2:
        return AppColors.ktas2;
      case 3:
        return AppColors.ktas3;
      case 4:
        return AppColors.ktas4;
      default:
        return AppColors.ktas5;
    }
  }
}

class _StatusBadge extends StatelessWidget {
  final String label;
  const _StatusBadge({required this.label});

  @override
  Widget build(BuildContext context) {
    final (bg, fg) = switch (label) {
      '서명 완료' => (AppColors.normal.withAlpha(30), AppColors.normal),
      '검사 완료' => (AppColors.normal.withAlpha(30), AppColors.normal),
      '분석 중' => (AppColors.warning.withAlpha(30), AppColors.warning),
      _ => (Colors.black12, Colors.black54),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
          color: bg, borderRadius: BorderRadius.circular(4)),
      margin: const EdgeInsets.only(right: 8),
      child: Text(label,
          style: TextStyle(
              color: fg, fontSize: 11, fontWeight: FontWeight.bold)),
    );
  }
}

class _DemoPatient {
  final String name;
  final int age;
  final int ktas;
  final String chief;
  final String status;
  _DemoPatient(this.name, this.age, this.ktas, this.chief, this.status);
}
