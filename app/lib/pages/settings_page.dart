import 'package:flutter/material.dart';
import '../auth/auth_factory.dart';
import '../config/api_config.dart';
import '../data/world_data.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'identity_verify_page.dart';
import 'wallet_page.dart';
import 'account_deletion_page.dart';
import 'privacy_policy_page.dart';
import 'user_agreement_page.dart';
import 'community_safety_page.dart';

/// 设置页：账号信息、隐私政策、退出登录、删除账号。
class SettingsPage extends StatelessWidget {
  const SettingsPage({super.key});

  @override
  Widget build(BuildContext context) {
    final state = AppState.instance;
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: AppBackground(
        child: SafeArea(
          bottom: false,
          child: AnimatedBuilder(
            animation: state,
            builder: (context, _) {
              return ListView(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
                children: [
                  _header(context),
                  const SizedBox(height: 14),
                  _userCard(state),
                  const SizedBox(height: 14),
                  _section('外观'),
                  _themeCard(),
                  const SizedBox(height: 18),
                  _section('账户'),
                  _tile(
                    icon: Icons.account_balance_wallet_outlined,
                    label: '钻石钱包',
                    subtitle:
                        '💎${state.wallet.diamonds} · 累计收益 ${WorldData.formatYuan(state.myElf?.earningsYuan ?? 0)}',
                    onTap: () => Navigator.of(context).push(
                      MaterialPageRoute(builder: (_) => const WalletPage()),
                    ),
                  ),
                  _tile(
                    icon: Icons.verified_user_outlined,
                    label: '实名认证',
                    subtitle: state.isIdentityVerified
                        ? '已认证 · ${state.identity?.maskedName ?? ''} · 可用于创建本人形象 AI'
                        : '上传身份证完成核验，用于创建本人形象 AI',
                    onTap: () => Navigator.of(context).push(
                      MaterialPageRoute(
                          builder: (_) => const IdentityVerifyPage()),
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
                    label: '内容安全与反馈',
                    subtitle: '发现违规或有建议？告诉我们',
                    onTap: () => Navigator.of(context).push(MaterialPageRoute(
                      builder: (_) => const CommunitySafetyPage())),
                  ),
                  if (state.currentUser != null) ...[
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
                      label: '注销账号',
                      onTap: () => _confirmDeleteAccount(context),
                    ),
                  ],
                ],
              );
            },
          ),
        ),
      ),
    );
  }

  Widget _header(BuildContext context) => Row(
        children: [
          InkWell(
            onTap: () => Navigator.of(context).maybePop(),
            borderRadius: BorderRadius.circular(8),
            child: Padding(
              padding: EdgeInsets.only(right: 8, top: 6, bottom: 6),
              child: Icon(
                Icons.arrow_back_ios_new,
                size: 17,
                color: AppColors.textSub,
                semanticLabel: '返回',
              ),
            ),
          ),
          Text(
            '设置',
            style: TextStyle(
                fontSize: 21,
                fontWeight: FontWeight.w700,
                color: AppColors.text),
          ),
        ],
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
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.w700,
                color: AppColors.onBrand,
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
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: AppColors.text,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  user == null ? '' : _maskPhone(user.phone),
                  style: TextStyle(fontSize: 11.5, color: AppColors.textMuted),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// 外观切换：跟随系统 / 白天 / 黑夜。选择结果持久化，重启后保留。
  Widget _themeCard() {
    return AnimatedBuilder(
      animation: ThemeController.instance,
      builder: (context, _) {
        return Container(
          padding: const EdgeInsets.all(4),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: AppColors.strokeSoft),
          ),
          child: Row(
            children: [
              _themeOption(
                  ThemeMode.system, Icons.brightness_auto_outlined, '跟随系统'),
              _themeOption(ThemeMode.light, Icons.light_mode_outlined, '白天'),
              _themeOption(ThemeMode.dark, Icons.dark_mode_outlined, '黑夜'),
            ],
          ),
        );
      },
    );
  }

  Widget _themeOption(ThemeMode mode, IconData icon, String label) {
    final selected = ThemeController.instance.mode == mode;
    final color = selected ? AppColors.onBrand : AppColors.textMuted;
    return Expanded(
      child: Semantics(
        button: true,
        selected: selected,
        label: label,
        child: InkWell(
          onTap: () => ThemeController.instance.setMode(mode),
          borderRadius: BorderRadius.circular(9),
          child: Container(
            margin: const EdgeInsets.symmetric(horizontal: 2),
            padding: const EdgeInsets.symmetric(vertical: 10),
            decoration: BoxDecoration(
              gradient: selected ? AppColors.brandGradient : null,
              borderRadius: BorderRadius.circular(9),
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(icon, size: 17, color: color),
                const SizedBox(height: 4),
                Text(
                  label,
                  style: TextStyle(
                    fontSize: 10.5,
                    fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                    color: color,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _section(String text) => Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: Text(
          text,
          style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w700,
              color: AppColors.textSub),
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
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w500,
                        color: AppColors.text,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      subtitle,
                      style:
                          TextStyle(fontSize: 10.5, color: AppColors.textMuted),
                    ),
                  ],
                ),
              ),
              Icon(Icons.chevron_right, size: 18, color: AppColors.textFaint),
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
                style: TextStyle(
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
    if (kind == PolicyKind.community) {
      Navigator.of(ctx).push(MaterialPageRoute(builder: (_) => const CommunitySafetyPage()));
      return;
    }
    if (kind == PolicyKind.terms) {
      Navigator.of(ctx).push(
        MaterialPageRoute(builder: (_) => const UserAgreementPage()),
      );
      return;
    }
    if (kind == PolicyKind.privacy) {
      Navigator.of(ctx).push(
        MaterialPageRoute(builder: (_) => const PrivacyPolicyPage()),
      );
      return;
    }
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
        Text('把技能做成技能书，自己组装，放进世界替你争夺注意力。'),
      ],
    );
  }

  void _confirmLogout(BuildContext ctx) {
    showDialog(
      context: ctx,
      builder: (dctx) => AlertDialog(
        backgroundColor: AppColors.surface,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        title:
            Text('退出登录', style: TextStyle(color: AppColors.text, fontSize: 16)),
        content: Text(
          '退出后需要重新登录才能继续使用。',
          style: TextStyle(
              fontSize: 12.5, color: AppColors.textMuted, height: 1.6),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dctx).pop(),
            child: Text('再想想', style: TextStyle(color: AppColors.textMuted)),
          ),
          TextButton(
            onPressed: () async {
              Navigator.of(dctx).pop();
              // 先撤销服务端会话并清掉本地令牌，否则冷启动会恢复成已登录。
              try {
                await createAuth().logout();
              } catch (_) {
                // 撤销失败也要清本地登录态，不能把用户卡在已登录
              }
              await AppState.instance.onLogout();
              if (!ctx.mounted) return;
              ScaffoldMessenger.of(ctx).showSnackBar(
                const SnackBar(content: Text('已退出登录')),
              );
            },
            child: Text('确认退出', style: TextStyle(color: AppColors.cyan)),
          ),
        ],
      ),
    );
  }

  Future<void> _confirmDeleteAccount(BuildContext ctx) async {
    final deleted = await Navigator.of(ctx).push<bool>(MaterialPageRoute(
      builder: (_) => AccountDeletionPage(
        auth: createAuth(), onDeleted: AppState.instance.onLogout),
    ));
    if (deleted != true || !ctx.mounted) return;
    final messenger = ScaffoldMessenger.of(ctx);
    Navigator.of(ctx).popUntil((route) => route.isFirst);
    messenger.showSnackBar(const SnackBar(content: Text('账号已注销')));
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
                  icon: Icon(Icons.arrow_back_ios_new,
                      size: 17, color: AppColors.textSub),
                ),
                const Expanded(child: SizedBox()),
              ],
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 0, 20, 14),
              child: Row(
                children: [
                  Text(title,
                      style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w700,
                          color: AppColors.text)),
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
                      Icon(Icons.description_outlined,
                          size: 40, color: AppColors.textMuted),
                      const SizedBox(height: 12),
                      Text(
                        '$title 正在编写中',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.w600,
                            color: AppColors.textSub),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        '完整内容将发布在 $url',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                            fontSize: 11,
                            color: AppColors.textMuted,
                            height: 1.5),
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
