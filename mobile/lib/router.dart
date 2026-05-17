import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'features/auth/login_page.dart';
import 'features/patient/patient_detail_page.dart';
import 'features/worklist/worklist_page.dart';

/// 앱 라우터 — Riverpod provider로 노출해서 인증 상태 기반 redirect 추가하기 쉽게 함.
final routerProvider = Provider<GoRouter>((ref) {
  return GoRouter(
    initialLocation: '/',
    routes: [
      GoRoute(path: '/', builder: (_, _) => const LoginPage()),
      GoRoute(path: '/worklist', builder: (_, _) => const WorklistPage()),
      GoRoute(
        path: '/patient/:id',
        builder: (_, state) => PatientDetailPage(
          patientId: state.pathParameters['id'] ?? '',
        ),
      ),
    ],
  );
});
