import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../shared/theme/app_theme.dart';

/// frontend/src/pages/v2/LoginPage.tsx와 동일 디자인:
/// 밝은 그라디언트 배경 (slate-50 → indigo-50 → violet-50)
/// + 흰 카드 + brand→ai 그라디언트 라운드 아이콘 + SSO 버튼
class LoginPage extends ConsumerWidget {
  const LoginPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [
              Color(0xFFF8FAFC), // slate-50
              Color(0xFFEEF2FF), // indigo-50 (brand-50)
              Color(0xFFF5F3FF), // violet-50 (ai-bg)
            ],
            stops: [0, 0.5, 1.0],
          ),
        ),
        child: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 380),
                child: Container(
                  padding: const EdgeInsets.all(28),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(12),
                    boxShadow: const [
                      BoxShadow(
                          color: Color(0x1117243F),
                          blurRadius: 12,
                          offset: Offset(0, 4)),
                    ],
                  ),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      // 브랜드 — brand→ai 그라디언트 라운드 사각 아이콘
                      Container(
                        height: 56,
                        width: 56,
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(16),
                          gradient: const LinearGradient(
                            begin: Alignment.topLeft,
                            end: Alignment.bottomRight,
                            colors: [AppColors.brand600, AppColors.aiAccent],
                          ),
                          boxShadow: [
                            BoxShadow(
                              color: AppColors.aiAccent.withAlpha(40),
                              blurRadius: 12,
                              offset: const Offset(0, 4),
                            ),
                          ],
                        ),
                        child: const Icon(Icons.monitor_heart,
                            color: Colors.white, size: 28),
                      ),
                      const SizedBox(height: 16),
                      const Text(
                        'say-6',
                        style: TextStyle(
                          fontSize: 24,
                          fontWeight: FontWeight.bold,
                          color: AppColors.slate900,
                        ),
                      ),
                      const SizedBox(height: 4),
                      const Text(
                        '응급실 AI 진단보조 시스템',
                        style: TextStyle(
                            fontSize: 13, color: AppColors.slate500),
                      ),
                      const SizedBox(height: 32),

                      // SSO 단일 로그인 (AI variant — 보라 그라디언트)
                      SizedBox(
                        width: double.infinity,
                        height: 52,
                        child: ElevatedButton.icon(
                          style: ElevatedButton.styleFrom(
                            backgroundColor: AppColors.aiAccent,
                            foregroundColor: Colors.white,
                            shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(8)),
                          ),
                          onPressed: () => context.go('/worklist'),
                          icon: const Icon(Icons.business, size: 18),
                          label: const Text(
                            '병원 SSO로 로그인',
                            style: TextStyle(
                                fontSize: 14, fontWeight: FontWeight.bold),
                          ),
                        ),
                      ),

                      const SizedBox(height: 12),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(Icons.verified_user,
                              size: 13, color: AppColors.emerald600),
                          const SizedBox(width: 5),
                          const Text(
                            '병원 직원증으로 통합 인증',
                            style: TextStyle(
                                fontSize: 11, color: AppColors.slate500),
                          ),
                        ],
                      ),
                      const SizedBox(height: 24),
                      const Text(
                        'v1.0 · © 2026 say-6',
                        style: TextStyle(
                            fontSize: 11, color: AppColors.slate400),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
