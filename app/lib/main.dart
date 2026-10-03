import 'package:flutter/material.dart';
import 'theme.dart';
import 'data/tools_repository.dart';
import 'pages/home_page.dart';
import 'pages/tools_list_page.dart';
import 'pages/tool_detail_page.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const OpenelfApp());
}

class OpenelfApp extends StatelessWidget {
  const OpenelfApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Openelf 开放精灵',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light,
      home: const SplashScreen(),
      onGenerateRoute: (settings) {
        final uri = Uri.parse(settings.name ?? '/');
        if (uri.pathSegments.length >= 2 && uri.pathSegments[0] == 'tools') {
          final toolId = uri.pathSegments[1];
          return MaterialPageRoute(
            builder: (_) => ToolDetailPage(toolId: toolId),
          );
        }
        return null;
      },
    );
  }
}

class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen> {
  bool _ready = false;

  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    await ToolsRepository().load();
    if (mounted) {
      setState(() => _ready = true);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!_ready) {
      return Scaffold(
        backgroundColor: AppColors.paper,
        body: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 64,
                height: 64,
                decoration: BoxDecoration(
                  color: AppColors.primary,
                  borderRadius: BorderRadius.circular(16),
                ),
                child: const Icon(Icons.auto_awesome, color: Colors.white, size: 32),
              ),
              const SizedBox(height: 20),
              const Text(
                'Openelf 开放精灵',
                style: TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.bold,
                  color: AppColors.ink,
                ),
              ),
              const SizedBox(height: 8),
              const Text(
                '全球 AI 工具图鉴',
                style: TextStyle(fontSize: 14, color: AppColors.inkSoft),
              ),
              const SizedBox(height: 32),
              const SizedBox(
                width: 120,
                child: LinearProgressIndicator(
                  backgroundColor: AppColors.line,
                  valueColor: AlwaysStoppedAnimation(AppColors.primary),
                  borderRadius: BorderRadius.all(Radius.circular(4)),
                ),
              ),
            ],
          ),
        ),
      );
    }
    return const HomePage();
  }
}
