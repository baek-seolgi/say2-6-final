import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'features/auth/login_page.dart';
import 'features/patient/patient_detail_page.dart';
import 'features/report/report_editor_page.dart';
import 'features/worklist/worklist_page.dart';

/// 의사용 모바일 라우팅 — 4개 라우트
/// /          → 로그인
/// /worklist  → 환자 목록 (의사가 환자 선택)
/// /patient/:id → AI 분석 (모달 권고 승인)
/// /patient/:id/report → AI 종합소견 생성 (검토·서명)
final routerProvider = Provider<GoRouter>((ref) {
  return GoRouter(
    initialLocation: '/',
    routes: [
      GoRoute(path: '/', builder: (_, _) => const LoginPage()),
      GoRoute(path: '/worklist', builder: (_, _) => const WorklistPage()),
      GoRoute(
        path: '/patient/:id',
        builder: (_, state) =>
            PatientDetailPage(patientId: state.pathParameters['id'] ?? ''),
      ),
      GoRoute(
        path: '/patient/:id/report',
        builder: (_, state) =>
            ReportEditorPage(encounterId: state.pathParameters['id'] ?? ''),
      ),
    ],
  );
});
