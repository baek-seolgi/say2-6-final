import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/api/client.dart';
import 'core/services/push_service.dart';
import 'firebase_options.dart';
import 'router.dart';
import 'shared/theme/app_theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Firebase 초기화 — flutterfire configure가 생성한 firebase_options.dart 사용.
  // 실패 시 앱은 계속 동작 (FCM만 비활성화).
  try {
    await Firebase.initializeApp(
      options: DefaultFirebaseOptions.currentPlatform,
    );
  } catch (e) {
    debugPrint('[firebase] init 실패 — 푸시 비활성화 ($e)');
  }

  runApp(const ProviderScope(child: Say6DoctorApp()));
}

class Say6DoctorApp extends ConsumerStatefulWidget {
  const Say6DoctorApp({super.key});

  @override
  ConsumerState<Say6DoctorApp> createState() => _Say6DoctorAppState();
}

class _Say6DoctorAppState extends ConsumerState<Say6DoctorApp> {
  bool _pushBooted = false;

  @override
  void initState() {
    super.initState();
    // Firebase가 초기화 됐을 때만 부트스트랩 시도.
    // initState에서 ref 접근은 안전 — postFrameCallback으로 미루기.
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      if (_pushBooted) return;
      _pushBooted = true;
      if (Firebase.apps.isEmpty) {
        debugPrint('[push] Firebase 미초기화 — bootstrap 스킵');
        return;
      }
      final dio = ref.read(dioProvider);
      final router = ref.read(routerProvider);
      await PushService.bootstrap(
        dio: dio,
        onTap: (encounterId) {
          // 알림 탭 → /patient/{encounter_id} 딥링크
          router.go('/patient/$encounterId');
        },
        // TODO: 로그인 후 ref.read(authProvider).user.id 같은 식으로 채우면
        // 해당 의사 단말만 타깃 푸시 가능
        userId: null,
      );
    });
  }

  @override
  Widget build(BuildContext context) {
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

    // 실제 폰·아주 좁은 창(<480) — 전체 화면 그대로
    if (screen.width < 480) return child;

    // 데스크탑 — 회색 backdrop 위에 폰 프레임 (높이는 무관, 짧으면 페이지 스크롤)
    return Scaffold(
      backgroundColor: AppColors.slate200,
      body: SingleChildScrollView(
        padding: const EdgeInsets.symmetric(vertical: 24),
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
      ),
    );
  }
}
