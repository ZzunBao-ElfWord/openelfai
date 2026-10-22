import 'package:flutter/material.dart';
import '../config/api_config.dart';
import '../data/world_data.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'wallet_page.dart';

/// 设置页：账号信息、隐私政策、退出登录、删除账号。
class SettingsPage extends StatelessWidget {
  const SettingsPage({super.key});

  @override
  Widget build(BuildContext context) {
    final state = AppState.instance;
    final user = state.currentUser;
    return AppBackground(
      child: SafeArea(
        bottom: false,
        child: AnimatedBuilder(
          animation: state,
          builder: (context, _) {
            return ListView(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
              children: [
                _header(),
                const SizedBox(height: 14),
                _userCard(state),
                const SizedBox(height: 14),
                _section('账户'),
                _tile(
                  icon: Icons.account_balance_wallet_outlined,
                  label: '钻石钱包',
                  subtitle: '💎${state.wallet.diamonds} · 累计收益 ${WorldData.formatYuan(state.myElf?.earningsYuan ?? 0)}',
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute(builder: (_) => const WalletPage()),
                  ),
                ),
                const SizedBox(height: 18),
                _section('法律与政策'),
                _tile(
                  icon: Icons.privacy_tip_outlined,
                  label: '隐私政策',
                  subtitle: '我们如何收集、使用、保护你的数据',
                  onTap: () => _openPolicy(context, PolicyKind.privacy),
                ),
                _tile(
                  icon: Icons.gavel_outlined,
                  label: '用户协议',
                  subtitle: '使用 OpenElf 的条款',
                  onTap: () => _openPolicy(context, PolicyKind.terms),
                ),
                _tile(
                  icon: Icons.description_outlined,
                  label: '社区规范',
                  subtitle: '发帖、评论、打赏的行为准则',
                  onTap: () => _openPolicy(context, PolicyKind.community),
                ),
                const SizedBox(height: 18),
                _section('其他'),
                _tile(
                  icon: Icons.info_outline,
                  label: '关于 OpenElf',
                  subtitle: 'v1.0.0 · 我的 AI，我做主',
                  onTap: () => _openAbout(context),
                ),
                _tile(
                  icon: Icons.flag_outlined,
                  label: '举报与反馈',
                  subtitle: '发现违规或有建议？告诉我们',
                  onTap: () => _snack(context, '举报入口即将开放'),
                ),
                const SizedBox(height: 24),
                _divider(),
                const SizedBox(height: 14),
                _dangerTile(
                  icon: Icons.logout,
                  label: '退出登录',
                  onTap: () => _confirmLogout(context),
                ),
                const SizedBox(height: 8),
                _dangerTile(
                  icon: Icons.delete_forever_outlined,
                  label: '删除账号',
                  onTap: () => _confirmDeleteAccount(context),
                ),
              ],
            );
          },
        ),
      ),
    );
  }

  Widget _header() => const Text(
        '设置',
        style: TextStyle(fontSize: 21, fontWeight: FontWeight.w700, color: AppColors.text),
      );

  Widget _userCard(AppState state) {
    final user = state.currentUser;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.strokeSoft),
        gradient: AppColors.brandGradientSoft,
      ),
      child: Row(
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              gradient: AppColors.brandGradient,
            ),
            alignment: Alignment.center,
            child: Text(
              user?.avatarInitial ?? '?',
              style: const TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.w700,
                color: AppColors.bgDeep,
              ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  user?.nickname ?? '未登录',
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: AppColors.text,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  user == null ? '' : _maskPhone(user.phone),
                  style: const TextStyle(fontSize: 11.5, color: AppColors.textMuted),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _section(String text) => Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: Text(
          text,
          style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: AppColors.textSub),
        ),
      );

  Widget _tile({
    required IconData icon,
    required String label,
    required String subtitle,
    required VoidCallback onTap,
  }) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(10),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 12),
          child: Row(
            children: [
              Container(
                width: 34,
                height: 34,
                decoration: BoxDecoration(
                  color: AppColors.surface,
                  borderRadius: BorderRadius.circular(8),
                ),
                alignment: Alignment.center,
                child: Icon(icon, size: 18, color: AppColors.textMuted),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      label,
                      style: const TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w500,
                        color: AppColors.text,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      subtitle,
                      style: const TextStyle(fontSize: 10.5, color: AppColors.textMuted),
                    ),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right, size: 18, color: AppColors.textFaint),
            ],
          ),
        ),
      ),
    );
  }

  Widget _dangerTile({
    required IconData icon,
    required String label,
    required VoidCallback onTap,
  }) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(10),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 14),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, size: 16, color: AppColors.warn),
              const SizedBox(width: 8),
              Text(
                label,
                style: const TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: AppColors.warn,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _divider() => Container(height: 1, color: AppColors.strokeSoft);

  // —— 交互 ——

  void _openPolicy(BuildContext ctx, PolicyKind kind) {
    final title = switch (kind) {
      PolicyKind.privacy => '隐私政策',
      PolicyKind.terms => '用户协议',
      PolicyKind.community => '社区规范',
    };
    final url = switch (kind) {
      PolicyKind.privacy => '${ApiConfig.baseUrl}/privacy',
      PolicyKind.terms => '${ApiConfig.baseUrl}/terms',
      PolicyKind.community => '${ApiConfig.baseUrl}/community',
    };
    Navigator.of(ctx).push(
      MaterialPageRoute(
        builder: (_) => _PolicyPage(title: title, url: url),
      ),
    );
  }

  void _openAbout(BuildContext ctx) {
    showAboutDialog(
      context: ctx,
      applicationName: 'OpenElf',
      applicationVersion: '1.0.0',
      children: const [
        SizedBox(height: 8),
        Text('我的 AI，我做主。'),
        SizedBox(height: 4),
        Text('把能力拆成模块，自己组装，放进世界替你争夺注意力。'),
      ],
    );
  }

  void _snack(BuildContext ctx, String msg) {
    ScaffoldMessenger.of(ctx).showSnackBar(SnackBar(content: Text(msg)));
  }

  void _confirmLogout(BuildContext ctx) {
    showDialog(
      context: ctx,
      builder: (dctx) => AlertDialog(
        backgroundColor: AppColors.bgDeep,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        title: const Text('退出登录', style: TextStyle(color: AppColors.text, fontSize: 16)),
        content: const Text(
          '退出后需要重新登录才能继续使用。',
          style: TextStyle(fontSize: 12.5, color: AppColors.textMuted, height: 1.6),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dctx).pop(),
            child: const Text('再想想', style: TextStyle(color: AppColors.textMuted)),
          ),
          TextButton(
            onPressed: () {
              Navigator.of(dctx).pop();
              AppState.instance.onLogout();
              ScaffoldMessenger.of(ctx).showSnackBar(
                const SnackBar(content: Text('已退出登录')),
              );
            },
            child: const Text('确认退出', style: TextStyle(color: AppColors.cyan)),
          ),
        ],
      ),
    );
  }

  void _confirmDeleteAccount(BuildContext ctx) {
    showDialog(
      context: ctx,
      builder: (dctx) => AlertDialog(
        backgroundColor: AppColors.bgDeep,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        title: const Text('删除账号', style: TextStyle(color: AppColors.warn, fontSize: 16)),
        content: const Text(
          '账号删除后，你的 AI、钻石、收益、打赏记录等所有数据将被永久清除，无法恢复。\n\n确认继续？',
          style: TextStyle(fontSize: 12.5, color: AppColors.textMuted, height: 1.6),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dctx).pop(),
            child: const Text('取消', style: TextStyle(color: AppColors.textMuted)),
          ),
          TextButton(
            onPressed: () {
              Navigator.of(dctx).pop();
              // 服务端 DELETE /auth/account 接口待实现，先本地退出
              AppState.instance.onLogout();
              ScaffoldMessenger.of(ctx).showSnackBar(
                const SnackBar(content: Text('本地已清除，服务端账号删除即将上线')),
              );
            },
            child: const Text('确认删除', style: TextStyle(color: AppColors.warn)),
          ),
        ],
      ),
    );
  }

  static String _maskPhone(String phone) {
    if (phone.length < 7) return phone;
    return '${phone.substring(0, 3)}****${phone.substring(phone.length - 4)}';
  }
}

enum PolicyKind { privacy, terms, community }

class _PolicyPage extends StatelessWidget {
  final String title;
  final String url;
  const _PolicyPage({required this.title, required this.url});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: Column(
          children: [
            Row(
              children: [
                IconButton(
                  onPressed: () => Navigator.of(context).pop(),
                  icon: const Icon(Icons.arrow_back_ios_new, size: 17, color: AppColors.textSub),
                ),
                const Expanded(child: SizedBox()),
              ],
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 0, 20, 14),
              child: Row(
                children: [
                  Text(title, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: AppColors.text)),
                ],
              ),
            ),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.all(20),
                child: Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: AppColors.strokeSoft),
                    color: AppColors.surface,
                  ),
                  child: ListView(
                    children: [
                      const Icon(Icons.description_outlined, size: 40, color: AppColors.textMuted),
                      const SizedBox(height: 12),
                      Text(
                        '$title 正在编写中',
                        textAlign: TextAlign.center,
                        style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: AppColors.textSub),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        '完整内容将发布在 $url',
                        textAlign: TextAlign.center,
                        style: const TextStyle(fontSize: 11, color: AppColors.textMuted, height: 1.5),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
