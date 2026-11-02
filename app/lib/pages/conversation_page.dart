import 'package:flutter/material.dart';
import '../theme.dart';
import '../state/app_state.dart';
import '../widgets/workbench_panel.dart';

/// Desktop-only workbench destination; existing dispatch, skills and AI selection stay unchanged.
class ConversationPage extends StatelessWidget {
  const ConversationPage({super.key});

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: AppColors.bg,
        body: SafeArea(
          child: LayoutBuilder(builder: (context, constraints) {
            return SingleChildScrollView(
              key: const PageStorageKey('desktop-conversation-scroll'),
              child: ConstrainedBox(
                constraints: BoxConstraints(minHeight: constraints.maxHeight),
                child: Align(
                  alignment: Alignment.topCenter,
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 1000),
                    child: SizedBox(
                      width: double.infinity,
                      child: AnimatedBuilder(
                        animation: AppState.instance,
                        builder: (context, _) => WorkbenchPanel(
                            wide: constraints.maxWidth >= 640,
                            desktopLayout: true),
                      ),
                    ),
                  ),
                ),
              ),
            );
          }),
        ),
      );
}
