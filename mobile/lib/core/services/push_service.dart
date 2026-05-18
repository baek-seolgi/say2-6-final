// PushService — FCM 토큰 획득 → 백엔드 /devices/register UPSERT.
//
// 사용 흐름:
//   1. main()에서 Firebase.initializeApp() 호출 후
//   2. PushService.bootstrap(dio: ..., onMessageTap: ...) 1회 호출
//   3. 권한 요청 → 토큰 발급 → /devices/register 등록
//   4. 포그라운드 메시지는 onMessage로, 알림 탭은 onMessageOpenedApp로 라우팅
//   5. 토큰 갱신 시(onTokenRefresh) 자동 재등록
//
// Firebase 미설정(google-services.json 없음) 환경에서는
// Firebase.initializeApp()이 실패 → bootstrap()이 조용히 noop으로 빠짐.

import 'dart:io' show Platform;

import 'package:dio/dio.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';

import '../../router.dart';
import '../../shared/widgets/top_notification_banner.dart';

class PushService {
  PushService._();

  /// 알림 탭 시 호출할 콜백 — go_router로 /patient/{encounter_id} 이동.
  /// onTap(encounterId)
  static Future<void> bootstrap({
    required Dio dio,
    required void Function(String encounterId) onTap,
    String? userId,
    String appVersion = '1.0.0',
  }) async {
    final messaging = FirebaseMessaging.instance;

    // ── 권한 요청 (iOS는 명시적 prompt 필요) ────────────
    final settings = await messaging.requestPermission(
      alert: true,
      badge: true,
      sound: true,
    );
    if (settings.authorizationStatus == AuthorizationStatus.denied) {
      debugPrint('[push] 권한 거부 — 푸시 수신 불가');
      return;
    }

    // ── 토큰 발급 + 등록 ──────────────────────────────
    final token = await messaging.getToken();
    if (token == null) {
      debugPrint('[push] 토큰 발급 실패');
      return;
    }
    await _registerToken(dio: dio, token: token, userId: userId, appVersion: appVersion);

    // 토큰 갱신 시 자동 재등록
    messaging.onTokenRefresh.listen((newToken) {
      _registerToken(dio: dio, token: newToken, userId: userId, appVersion: appVersion);
    });

    // ── 알림 핸들러 ──────────────────────────────────
    // 1) 앱 죽어있다가 알림 탭으로 launch
    final initialMessage = await messaging.getInitialMessage();
    if (initialMessage != null) {
      _handleTap(initialMessage, onTap);
    }
    // 2) 백그라운드 → 알림 탭 → 앱 포그라운드 복귀
    FirebaseMessaging.onMessageOpenedApp.listen((msg) => _handleTap(msg, onTap));
    // 3) 포그라운드 수신 — 상단 Top Banner로 in-app 표시.
    //    탭하면 NotificationsPanel 대신 해당 환자 화면으로 즉시 이동.
    FirebaseMessaging.onMessage.listen((msg) {
      debugPrint('[push] 포그라운드 수신 — ${msg.notification?.title}');
      final ctx = rootNavigatorKey.currentContext;
      if (ctx == null) return; // 앱 초기화 도중
      final n = msg.notification;
      final risk = (msg.data['risk_level'] ?? '').toString().toLowerCase();
      final encounterId = (msg.data['encounter_id'] ?? '').toString();
      // ignore: use_build_context_synchronously — rootNavigatorKey.currentContext는
      // 비동기 갭이 아니라 즉시 위 라인에서 가져온 context이므로 안전.
      TopNotificationBanner.show(
        ctx,
        title: n?.title ?? '새 알림',
        body: n?.body,
        critical: risk == 'critical',
        onTap: encounterId.isEmpty ? null : () => onTap(encounterId),
      );
    });
  }

  static Future<void> _registerToken({
    required Dio dio,
    required String token,
    required String? userId,
    required String appVersion,
  }) async {
    final platform = kIsWeb
        ? 'web'
        : (Platform.isIOS ? 'ios' : 'android');
    try {
      await dio.post(
        '/devices/register',
        data: {
          'token': token,
          'platform': platform,
          'user_id': ?userId,
          'app_version': appVersion,
        },
      );
      debugPrint('[push] 토큰 등록 완료 (platform=$platform)');
    } catch (e) {
      debugPrint('[push] 토큰 등록 실패: $e');
    }
  }

  static void _handleTap(RemoteMessage msg, void Function(String) onTap) {
    final data = msg.data;
    final encounterId = (data['encounter_id'] ?? '').toString();
    if (encounterId.isEmpty) return;
    onTap(encounterId);
  }
}
