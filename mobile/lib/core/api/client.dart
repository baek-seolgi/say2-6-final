import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// API base URL — 로컬 개발 시 docker-compose backend(8000)에 연결.
/// 운영 빌드 시 --dart-define=API_BASE_URL=https://... 로 override.
/// (Image.network 같은 dio 외 호출도 같은 origin을 쓰도록 외부 노출)
const apiBaseUrl = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: 'http://localhost:8000',
);

/// 전역 Dio 인스턴스 — 토큰 인터셉터·재시도 정책 등 후속 추가 가능.
final dioProvider = Provider<Dio>((ref) {
  final dio = Dio(
    BaseOptions(
      baseUrl: apiBaseUrl,
      connectTimeout: const Duration(seconds: 10),
      receiveTimeout: const Duration(seconds: 30),
      contentType: 'application/json',
    ),
  );
  // TODO: AuthInterceptor — Cognito access token 자동 첨부
  // TODO: RetryInterceptor — 5xx 또는 네트워크 오류 시 백오프 재시도
  return dio;
});
