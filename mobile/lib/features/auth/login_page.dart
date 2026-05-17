import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../shared/theme/app_theme.dart';

class LoginPage extends ConsumerWidget {
  const LoginPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      backgroundColor: AppColors.vunoBg,
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 360),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 24),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  // 로고
                  Container(
                    height: 56,
                    width: 56,
                    decoration: const BoxDecoration(color: AppColors.vunoCyan),
                    child: const Icon(Icons.monitor_heart,
                        size: 32, color: AppColors.vunoBg),
                  ),
                  const SizedBox(height: 16),
                  const Text(
                    'SAY-6',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 28,
                      fontWeight: FontWeight.bold,
                      letterSpacing: 2.5,
                    ),
                  ),
                  const Text(
                    '의사용 모바일',
                    style: TextStyle(
                        color: AppColors.vunoCyan,
                        fontSize: 12,
                        letterSpacing: 2),
                  ),
                  const SizedBox(height: 48),
                  // 로그인 (지금은 데모 — 바로 통과)
                  ElevatedButton(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.vunoCyan,
                      foregroundColor: AppColors.vunoBg,
                      minimumSize: const Size(double.infinity, 52),
                    ),
                    onPressed: () => context.go('/worklist'),
                    child: const Text('의사 데모 로그인',
                        style: TextStyle(
                            fontSize: 15, fontWeight: FontWeight.bold)),
                  ),
                  const SizedBox(height: 12),
                  TextButton(
                    onPressed: () {
                      // TODO: Cognito OAuth flow
                    },
                    child: const Text(
                      'Cognito SSO로 로그인 (예정)',
                      style:
                          TextStyle(color: AppColors.vunoMuted, fontSize: 12),
                    ),
                  ),
                  const SizedBox(height: 32),
                  // 진단 보조 시스템 안내 (웹과 일관)
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: Colors.white.withAlpha(15),
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: const Text(
                      '⚠ 본 시스템의 AI 분석 결과는 진단 보조 자료이며, 의사를 대체하지 않습니다.',
                      style: TextStyle(
                          color: AppColors.vunoMuted,
                          fontSize: 11,
                          height: 1.5),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
