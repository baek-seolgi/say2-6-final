import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'router.dart';
import 'shared/theme/app_theme.dart';

void main() {
  runApp(const ProviderScope(child: Say6DoctorApp()));
}

class Say6DoctorApp extends ConsumerWidget {
  const Say6DoctorApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(routerProvider);
    return MaterialApp.router(
      title: 'say-6 doctor',
      debugShowCheckedModeBanner: false,
      theme: buildSay6Theme(),
      routerConfig: router,
      builder: (context, child) => _PhoneFrame(child: child ?? const SizedBox()),
    );
  }
}

/// 데스크탑 브라우저에서 Flutter web을 폰 화면 비율(iPhone 14 ~ 390x844)로 보여주는 wrapper.
/// 실제 모바일·좁은 창에선 전체 화면으로 fall through.
class _PhoneFrame extends StatelessWidget {
  final Widget child;
  const _PhoneFrame({required this.child});

  static const double _phoneWidth = 390;
  static const double _phoneHeight = 844;

  @override
  Widget build(BuildContext context) {
    final screen = MediaQuery.of(context).size;

    // 좁은 창(태블릿·실제 폰) — 전체 화면 그대로
    if (screen.width < _phoneWidth + 60 || screen.height < _phoneHeight + 60) {
      return child;
    }

    // 넓은 창 — 회색 backdrop 위에 폰 프레임
    return ColoredBox(
      color: AppColors.slate200,
      child: Center(
        child: Container(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(36),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withAlpha(60),
                blurRadius: 24,
                offset: const Offset(0, 8),
              ),
            ],
          ),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(36),
            child: SizedBox(
              width: _phoneWidth,
              height: _phoneHeight,
              // 자식 위젯이 "390 x 844 폰 화면"으로 인식하도록 MediaQuery override
              child: MediaQuery(
                data: MediaQuery.of(context).copyWith(
                  size: const Size(_phoneWidth, _phoneHeight),
                  padding: EdgeInsets.zero,
                  viewPadding: EdgeInsets.zero,
                  viewInsets: EdgeInsets.zero,
                ),
                child: child,
              ),
            ),
          ),
        ),
      ),
    );
  }
}
