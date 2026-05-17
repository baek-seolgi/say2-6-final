import 'package:flutter/material.dart';

/// say-6 컬러 토큰 (웹 frontend의 vuno-* / brand-* 와 동일 의도)
class AppColors {
  // VUNO 다크 베이스
  static const vunoBg = Color(0xFF0A1929);
  static const vunoCyan = Color(0xFF00D9FF);
  static const vunoCyanDim = Color(0xFF0EA5E9);
  static const vunoMuted = Color(0xFFB0BEC5);

  // KTAS (응급도)
  static const ktas1 = Color(0xFFEF4444); // critical red
  static const ktas2 = Color(0xFFF97316); // urgent orange
  static const ktas3 = Color(0xFFFBBF24); // yellow
  static const ktas4 = Color(0xFF22C55E); // green
  static const ktas5 = Color(0xFF3B82F6); // blue

  // 상태
  static const risk = Color(0xFFDC2626);
  static const warning = Color(0xFFF59E0B);
  static const normal = Color(0xFF10B981);
}

ThemeData buildSay6Theme() {
  const seedColor = AppColors.vunoCyan;
  return ThemeData(
    useMaterial3: true,
    colorScheme: ColorScheme.fromSeed(
      seedColor: seedColor,
      brightness: Brightness.light,
    ),
    fontFamily: 'system-ui',
    appBarTheme: const AppBarTheme(
      backgroundColor: AppColors.vunoBg,
      foregroundColor: Colors.white,
      elevation: 0,
      centerTitle: false,
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: AppColors.vunoBg,
        foregroundColor: Colors.white,
        minimumSize: const Size(double.infinity, 48),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
      ),
    ),
  );
}
