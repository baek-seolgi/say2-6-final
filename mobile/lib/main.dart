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
    );
  }
}
