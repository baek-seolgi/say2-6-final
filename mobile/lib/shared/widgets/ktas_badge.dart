import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

/// frontend/src/components/v2/KtasBadge.tsx와 동일 동작.
/// "KTAS-{n} {label}" — bg는 KtasMeta의 컬러.
class KtasBadge extends StatelessWidget {
  final int level;
  final bool showLabel;
  final double fontSize;
  final EdgeInsetsGeometry padding;

  const KtasBadge({
    super.key,
    required this.level,
    this.showLabel = true,
    this.fontSize = 11,
    this.padding = const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
  });

  @override
  Widget build(BuildContext context) {
    final meta = KtasMeta.of(level);
    return Container(
      padding: padding,
      decoration: BoxDecoration(
        color: meta.bg,
        borderRadius: BorderRadius.circular(4),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            'KTAS-$level',
            style: TextStyle(
              color: Colors.white,
              fontSize: fontSize,
              fontWeight: FontWeight.bold,
            ),
          ),
          if (showLabel) ...[
            const SizedBox(width: 4),
            Text(
              meta.label,
              style: TextStyle(
                color: Colors.white.withAlpha(230),
                fontSize: fontSize,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ],
      ),
    );
  }
}
