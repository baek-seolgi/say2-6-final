import 'package:flutter/material.dart';

import '../../shared/theme/app_theme.dart';

/// frontend/src/components/v2/EcgClinicalSheet.tsx의 Flutter 포트.
/// 핑크 그리드 ECG 종이 + 12-lead + Lead II 리듬 스트립.
///
/// 모바일에선 RecCard "검사결과지" 버튼 → 풀스크린 모달로 표시.
class EcgClinicalSheet extends StatelessWidget {
  final String patientName;
  final int age;
  final String sex; // 'M' | 'F'
  final String? patientId;
  final DateTime? recordedAt;
  // 측정값
  final int hr;
  final int prInterval;
  final int qrsWidth;
  final int qt;
  final int qtc;
  final int pAxis;
  final int qrsAxis;
  // 판정
  final List<({String code, String text})> interpretation;

  const EcgClinicalSheet({
    super.key,
    this.patientName = '환자',
    this.age = 0,
    this.sex = 'M',
    this.patientId,
    this.recordedAt,
    this.hr = 88,
    this.prInterval = 148,
    this.qrsWidth = 88,
    this.qt = 372,
    this.qtc = 398,
    this.pAxis = 52,
    this.qrsAxis = 38,
    this.interpretation = const [
      (code: '1100', text: 'Sinus rhythm'),
      (code: '9110', text: '** normal ECG **'),
    ],
  });

  String get _sexLabel => sex == 'M' ? '남' : sex == 'F' ? '여' : sex;
  String get _tsLine {
    final t = recordedAt ?? DateTime.now();
    final local = t.toLocal();
    final hh = local.hour.toString().padLeft(2, '0');
    final mm = local.minute.toString().padLeft(2, '0');
    return '${local.year}.${local.month.toString().padLeft(2, '0')}.${local.day.toString().padLeft(2, '0')} $hh:$mm';
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      color: Colors.white,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // ── 헤더 ──
          Container(
            padding:
                const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
            decoration: const BoxDecoration(
                border: Border(bottom: BorderSide(color: AppColors.slate400))),
            child: DefaultTextStyle(
              style: const TextStyle(
                  fontSize: 10,
                  color: AppColors.slate800,
                  fontFamily: 'monospace'),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // 좌: 환자
                      Expanded(
                        flex: 5,
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            _kv('ID:', patientId ?? '—', bold: true),
                            _kv('Name:', patientName),
                            _kv('SEX/AGE:', '$_sexLabel · $age세'),
                            _kv('Medication:', 'None',
                                valueColor: AppColors.slate400),
                          ],
                        ),
                      ),
                      const SizedBox(width: 10),
                      // 중: 측정값
                      Expanded(
                        flex: 5,
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            _kv('Heart Rate', '$hr bpm', bold: true),
                            _kv('PR Int.', '$prInterval ms'),
                            _kv('QRS Int.', '$qrsWidth ms'),
                            _kv('QT/QTc', '$qt / $qtc ms'),
                            _kv('P/QRS', '$pAxis° / $qrsAxis°'),
                          ],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text('10mm/mV  25mm/s'),
                      Text(_tsLine,
                          style:
                              const TextStyle(color: AppColors.slate500)),
                      const Text('Minnesota (03-05)',
                          style: TextStyle(color: AppColors.slate500)),
                    ],
                  ),
                ],
              ),
            ),
          ),
          // ── 12-Lead 그리드 ──
          Padding(
            padding: const EdgeInsets.all(8),
            child: AspectRatio(
              aspectRatio: 720 / 270,
              child: CustomPaint(
                painter: _EcgGridPainter(layout: _Ecg12LeadLayout()),
              ),
            ),
          ),
          // ── 판정 코드 ──
          Padding(
            padding:
                const EdgeInsets.symmetric(horizontal: 10, vertical: 2),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (final it in interpretation)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 2),
                    child: Row(
                      children: [
                        SizedBox(
                          width: 40,
                          child: Text(it.code,
                              style: const TextStyle(
                                  fontFamily: 'monospace',
                                  fontSize: 10,
                                  color: AppColors.slate500)),
                        ),
                        Text(
                          it.text,
                          style: TextStyle(
                              fontFamily: 'monospace',
                              fontSize: 10,
                              fontWeight: it.text.contains('*')
                                  ? FontWeight.bold
                                  : FontWeight.normal,
                              color: AppColors.slate800),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
          ),
          // ── Lead II 리듬 스트립 ──
          Padding(
            padding: const EdgeInsets.fromLTRB(8, 6, 8, 8),
            child: AspectRatio(
              aspectRatio: 720 / 110,
              child: CustomPaint(
                painter: _EcgGridPainter(layout: _EcgRhythmLayout()),
              ),
            ),
          ),
          // ── 푸터 ──
          Container(
            padding:
                const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: const BoxDecoration(
                border: Border(top: BorderSide(color: AppColors.slate200))),
            child: const Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('1350K · say-6 응급실 멀티모달 AI 진단 보조',
                    style: TextStyle(
                        fontSize: 9,
                        color: AppColors.slate400,
                        fontFamily: 'monospace')),
                Text('v1.2',
                    style: TextStyle(
                        fontSize: 9,
                        color: AppColors.slate400,
                        fontFamily: 'monospace')),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _kv(String k, String v,
      {bool bold = false, Color? valueColor}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 1),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 70,
            child: Text(k,
                style: const TextStyle(
                    color: AppColors.slate500, fontFamily: 'monospace')),
          ),
          Expanded(
            child: Text(v,
                style: TextStyle(
                  color: valueColor ?? AppColors.slate800,
                  fontWeight: bold ? FontWeight.bold : FontWeight.normal,
                  fontFamily: 'monospace',
                )),
          ),
        ],
      ),
    );
  }
}

// ────────────────────────────────────────────────────────────
// 12-Lead 4×3 레이아웃 (I aVR V1 V4 / II aVL V2 V5 / III aVF V3 V6)
// ────────────────────────────────────────────────────────────
abstract class _EcgLayout {
  void paintLeads(Canvas canvas, Size size);
  Size get logicalSize;
}

class _Ecg12LeadLayout extends _EcgLayout {
  static const _leads = [
    ['I', 'aVR', 'V1', 'V4'],
    ['II', 'aVL', 'V2', 'V5'],
    ['III', 'aVF', 'V3', 'V6'],
  ];

  @override
  Size get logicalSize => const Size(720, 270);

  @override
  void paintLeads(Canvas canvas, Size size) {
    final cellW = size.width / 4;
    final cellH = size.height / 3;
    final stroke = Paint()
      ..color = AppColors.slate900
      ..strokeWidth = 0.9
      ..style = PaintingStyle.stroke;
    final labelStyle = const TextStyle(
        fontFamily: 'monospace',
        fontSize: 10,
        color: AppColors.slate700,
        fontWeight: FontWeight.bold);

    for (int row = 0; row < 3; row++) {
      for (int col = 0; col < 4; col++) {
        final x0 = col * cellW;
        final y0 = row * cellH;
        // 라벨
        final tp = TextPainter(
          text: TextSpan(text: _leads[row][col], style: labelStyle),
          textDirection: TextDirection.ltr,
        )..layout();
        tp.paint(canvas, Offset(x0 + 4, y0 + 4));
        // calibration pulse + 박동 3개
        final baseline = y0 + cellH * 0.55;
        canvas.drawPath(
          _calibrationPath(x0 + 2, baseline, cellH * 0.4),
          stroke,
        );
        canvas.drawPath(
          _beatPath(
              startX: x0 + 22,
              baseline: baseline,
              beatWidth: (cellW - 28) / 3,
              count: 3,
              amplitude: cellH * 0.35),
          stroke,
        );
      }
    }
  }
}

class _EcgRhythmLayout extends _EcgLayout {
  @override
  Size get logicalSize => const Size(720, 110);

  @override
  void paintLeads(Canvas canvas, Size size) {
    final stroke = Paint()
      ..color = AppColors.slate900
      ..strokeWidth = 0.9
      ..style = PaintingStyle.stroke;
    final labelStyle = const TextStyle(
        fontFamily: 'monospace',
        fontSize: 9,
        color: AppColors.slate700,
        fontWeight: FontWeight.bold);
    final tp = TextPainter(
      text: TextSpan(
          text:
              'Rhythm[II]  10mm/mV  25mm/s  Filter:(H60 D)100Hz',
          style: labelStyle),
      textDirection: TextDirection.ltr,
    )..layout();
    tp.paint(canvas, const Offset(6, 4));
    final baseline = size.height * 0.6;
    canvas.drawPath(
      _calibrationPath(2, baseline, size.height * 0.4),
      stroke,
    );
    canvas.drawPath(
      _beatPath(
          startX: 26,
          baseline: baseline,
          beatWidth: (size.width - 32) / 12,
          count: 12,
          amplitude: size.height * 0.35),
      stroke,
    );
  }
}

// calibration pulse — 1mV = amplitude (직사각 박스 모양)
Path _calibrationPath(double startX, double baseline, double amplitude) {
  final p = Path();
  p.moveTo(startX, baseline);
  p.lineTo(startX + 4, baseline);
  p.lineTo(startX + 4, baseline - amplitude);
  p.lineTo(startX + 8, baseline - amplitude);
  p.lineTo(startX + 8, baseline);
  p.lineTo(startX + 12, baseline);
  return p;
}

// 정상 sinus rhythm 박동 패턴 — count개 연속
Path _beatPath({
  required double startX,
  required double baseline,
  required double beatWidth,
  required int count,
  required double amplitude,
}) {
  final p = Path();
  p.moveTo(startX, baseline);
  for (int i = 0; i < count; i++) {
    final x = startX + i * beatWidth;
    final w = beatWidth;
    // 작은 P 파
    p.lineTo(x + w * 0.08, baseline);
    p.quadraticBezierTo(
      x + w * 0.12, baseline - amplitude * 0.15,
      x + w * 0.16, baseline - amplitude * 0.2,
    );
    p.quadraticBezierTo(
      x + w * 0.20, baseline - amplitude * 0.15,
      x + w * 0.24, baseline,
    );
    p.lineTo(x + w * 0.30, baseline);
    // QRS — Q dip, R spike, S dip
    p.lineTo(x + w * 0.32, baseline + amplitude * 0.1);
    p.lineTo(x + w * 0.34, baseline - amplitude * 0.95);
    p.lineTo(x + w * 0.36, baseline + amplitude * 0.3);
    p.lineTo(x + w * 0.38, baseline);
    p.lineTo(x + w * 0.48, baseline);
    // T 파
    p.quadraticBezierTo(
      x + w * 0.56, baseline - amplitude * 0.3,
      x + w * 0.65, baseline - amplitude * 0.3,
    );
    p.quadraticBezierTo(
      x + w * 0.75, baseline - amplitude * 0.3,
      x + w * 0.82, baseline,
    );
    p.lineTo(x + w, baseline);
  }
  return p;
}

class _EcgGridPainter extends CustomPainter {
  final _EcgLayout layout;
  _EcgGridPainter({required this.layout});

  @override
  void paint(Canvas canvas, Size size) {
    // 핑크 그리드 배경
    final smPaint = Paint()
      ..color = const Color(0xFFfda4af).withAlpha(80)
      ..strokeWidth = 0.4;
    final lgPaint = Paint()
      ..color = const Color(0xFFfb7185).withAlpha(120)
      ..strokeWidth = 0.7;
    final bg = Paint()..color = const Color(0xFFfff1f2).withAlpha(60);
    canvas.drawRect(Offset.zero & size, bg);

    // 5px 마다 small line, 25px 마다 large line (대략 ECG 표준)
    const sm = 6.0;
    const lg = 30.0;
    for (double x = 0; x <= size.width; x += sm) {
      canvas.drawLine(Offset(x, 0), Offset(x, size.height),
          x % lg == 0 ? lgPaint : smPaint);
    }
    for (double y = 0; y <= size.height; y += sm) {
      canvas.drawLine(Offset(0, y), Offset(size.width, y),
          y % lg == 0 ? lgPaint : smPaint);
    }

    // 외곽선 (장미빛)
    canvas.drawRect(
      Offset.zero & size,
      Paint()
        ..color = const Color(0xFFfb7185)
        ..strokeWidth = 1
        ..style = PaintingStyle.stroke,
    );

    // lead 파형 — layout이 logical size 기준으로 path 그리므로
    // canvas를 logical → physical 비율로 scale
    final scaleX = size.width / layout.logicalSize.width;
    final scaleY = size.height / layout.logicalSize.height;
    canvas.save();
    canvas.scale(scaleX, scaleY);
    layout.paintLeads(canvas, layout.logicalSize);
    canvas.restore();
  }

  @override
  bool shouldRepaint(_EcgGridPainter old) => false;
}

// ────────────────────────────────────────────────────────────
// 풀스크린 모달 헬퍼 — RecCard에서 호출
// ────────────────────────────────────────────────────────────
Future<void> showEcgClinicalSheet(
  BuildContext context, {
  required String patientName,
  required int age,
  required String sex,
  String? patientId,
}) {
  return showDialog<void>(
    context: context,
    barrierColor: Colors.black54,
    builder: (ctx) => Dialog.fullscreen(
      backgroundColor: AppColors.slate100,
      child: Scaffold(
        backgroundColor: AppColors.slate100,
        appBar: AppBar(
          leading: const SizedBox(),
          leadingWidth: 0,
          title: const Text('12-Lead 심전도 검사결과지',
              style: TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.bold,
                  color: AppColors.slate900)),
          actions: [
            IconButton(
                icon: const Icon(Icons.close, color: AppColors.slate700),
                onPressed: () => Navigator.pop(ctx)),
          ],
        ),
        body: SingleChildScrollView(
          padding: const EdgeInsets.all(12),
          child: Container(
            decoration: BoxDecoration(
              color: Colors.white,
              border: Border.all(color: AppColors.slate300),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withAlpha(20),
                  blurRadius: 8,
                  offset: const Offset(0, 2),
                ),
              ],
            ),
            child: EcgClinicalSheet(
              patientName: patientName,
              age: age,
              sex: sex,
              patientId: patientId,
            ),
          ),
        ),
      ),
    ),
  );
}
