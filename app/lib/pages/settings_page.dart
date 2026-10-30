import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../auth/auth_factory.dart';
import '../config/release_info.dart';
import 'account_deletion_page.dart';
import 'push_settings_page.dart';
import 'community_safety_page.dart';
import 'privacy_policy_page.dart';
import 'user_agreement_page.dart';
import '../data/world_data.dart';
import '../models/app_content.dart';
import '../services/app_content_service.dart';
import 'blocked_page.dart';
import '../services/stage_bind_service.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'identity_verify_page.dart';
import 'stage_bind_page.dart';
import 'wallet_page.dart';

/// 设置页：账号信息、隐私政策、退出登录、删除账号。
class SettingsPage extends StatefulWidget {
  const SettingsPage({super.key});

  @override
  State<SettingsPage> createState() => _SettingsPageState();
}

class _SettingsPageState extends State<SettingsPage> {
  final AppContentService _contentService = AppContentService.instance;

  @override
  void initState() {
    super.initState();
    // 进设置页顺手刷新一次运营配置，保证文案/政策更新尽快生效
    _contentService.refreshIfStale();
  }

  @override
  Widget build(BuildContext context) {
    final state = AppState.instance;
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: AppBackground(
        child: SafeArea(
          bottom: false,
          child: ValueListenableBuilder<AppContent>(
            valueListenable: _contentService.content,
            builder: (context, content, _) => AnimatedBuilder(
              animation: Listenable.merge([state, StageBindService.instance]),
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
                          '💎${state.wallet.diamonds} · 累计收益 ${WorldData.formatYuan(state.creatorEarningsYuan)}',
                      onTap: () => Navigator.of(context).push(
                        MaterialPageRoute(builder: (_) => const WalletPage()),
                      ),
                    ),
                    _tile(
                      icon: Icons.verified_user_outlined,
                      label: '实名认证',
                      subtitle: state.isIdentityVerified
                          ? '已认证 · ${state.identity?.maskedName ?? ''} · 可用于创建本人形象 AI'
                          : content.text('app.identity.note'),
                      onTap: () => Navigator.of(context).push(
                        MaterialPageRoute(
                            builder: (_) => const IdentityVerifyPage()),
                      ),
                    ),
                    _tile(
                      icon: Icons.public_rounded,
                      label: '作品分享平台',
                      subtitle: _stageBindSubtitle(),
                      onTap: () => Navigator.of(context).push(
                        MaterialPageRoute(
                            builder: (_) => const StageBindPage()),
                      ),
                    ),
                    const SizedBox(height: 18),
                    _section('隐私与推荐'),
                    SwitchListTile.adaptive(
                      contentPadding: EdgeInsets.zero,
                      value: state.personalizedRecommendation,
                      activeColor: AppColors.cyan,
                      title: Text('个性化推荐',
                          style:
                              TextStyle(fontSize: 13.5, color: AppColors.text)),
                      subtitle: Text(
                        state.personalizedRecommendation
                            ? '已开启：按互动与兴趣排序'
                            : '已关闭：信息流按发布时间排序',
                        style:
                            TextStyle(fontSize: 11, color: AppColors.textMuted),
                      ),
                      onChanged: (value) =>
                          state.setPersonalizedRecommendation(value),
                    ),
                    _tile(
                      icon: Icons.block_outlined,
                      label: '已拉黑',
                      subtitle: '管理被拉黑的 AI 与用户，可随时取消',
                      onTap: () => Navigator.of(context).push(
                        MaterialPageRoute(builder: (_) => const BlockedPage()),
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
                        icon: Icons.notifications_outlined,
                        label: '消息通知',
                        subtitle: '管理消息提醒和系统通知权限',
                        onTap: () => Navigator.of(context).push(
                            MaterialPageRoute(
                                builder: (_) => const PushSettingsPage()))),
                    _tile(
                        icon: Icons.shield_outlined,
                        label: '内容安全与反馈',
                        subtitle: '举报、屏蔽与社区规范',
                        onTap: () => Navigator.of(context).push(
                            MaterialPageRoute(
                                builder: (_) => const CommunitySafetyPage()))),
                    _tile(
                      icon: Icons.info_outline,
                      label: '关于 ${content.text('app.about.name')}',
                      subtitle:
                          '${ReleaseInfo.label} · ${content.text('app.about.slogan')}',
                      onTap: () => _openAbout(context, content),
                    ),
                    _tile(
                      icon: Icons.flag_outlined,
                      label: '举报与反馈',
                      subtitle: content.flag('app.feedback.enabled')
                          ? content.text('app.feedback.note')
                          : '反馈渠道暂未开放',
                      onTap: () => _openFeedback(context, content),
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

  /// 绑定摘要：未绑定时给引导文案，已绑定时列出平台名。
  String _stageBindSubtitle() {
    final binds = StageBindService.instance;
    final bound = StagePlatform.values.where(binds.isBound).toList();
    if (bound.isEmpty) {
      return '分享作品到抖音等平台，由你确认发布';
    }
    return '常用 ${bound.length} 个 · ${bound.map((p) => p.label).join('、')}';
  }

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
    if (kind == PolicyKind.privacy) {
      Navigator.of(ctx)
          .push(MaterialPageRoute(builder: (_) => const PrivacyPolicyPage()));
      return;
    }
    if (kind == PolicyKind.terms) {
      Navigator.of(ctx)
          .push(MaterialPageRoute(builder: (_) => const UserAgreementPage()));
      return;
    }
    final title = switch (kind) {
      PolicyKind.privacy => '隐私政策',
      PolicyKind.terms => '用户协议',
      PolicyKind.community => '社区规范',
    };
    final slug = switch (kind) {
      PolicyKind.privacy => 'privacy',
      PolicyKind.terms => 'terms',
      PolicyKind.community => 'community',
    };
    Navigator.of(ctx).push(
      MaterialPageRoute(
        builder: (_) => _PolicyPage(
          title: title,
          document: _contentService.content.value.document(slug),
        ),
      ),
    );
  }

  void _openAbout(BuildContext ctx, AppContent content) {
    showAboutDialog(
      context: ctx,
      applicationName: content.text('app.about.name'),
      applicationVersion: ReleaseInfo.label,
      children: [
        const SizedBox(height: 8),
        Text(content.text('app.about.intro')),
        const SizedBox(height: 6),
        Text(content.text('app.about.copyright')),
        const SizedBox(height: 8),
        Align(
          alignment: Alignment.centerLeft,
          child: TextButton(
            style: TextButton.styleFrom(padding: EdgeInsets.zero),
            onPressed: () => _openSdkList(ctx),
            child: Text('第三方 SDK 清单',
                style: TextStyle(fontSize: 12, color: AppColors.cyan)),
          ),
        ),
      ],
    );
  }

  /// PIPL 要求的第三方 SDK 目录：说明名称、用途与处理的个人信息类型。
  void _openSdkList(BuildContext ctx) {
    const items = <List<String>>[
      ['极光推送 JPush', '经你同意后发送消息通知', '推送注册标识、设备与网络信息'],
      ['shared_preferences', '本地保存主题与浏览偏好', '设备本地偏好，不含身份信息'],
      ['flutter_secure_storage', '加密保存登录令牌', '登录凭证'],
      ['in_app_purchase', 'iOS 数字商品内购', '购买凭证与订单号'],
      ['阿里云验证码', '登录人机校验', '设备与网络信息'],
      ['阿里云实人认证（服务端）', '创作者实名核验', '姓名、证件号、证件照片（仅传输，核验后脱敏留存）'],
      ['视频播放 / 音频播放 / 分享组件', '内容播放与站外分享', '播放与分享所需的最少设备信息'],
      ['相册选择组件', '上传身份证或封面', '你主动选择的图片'],
    ];
    showDialog<void>(
      context: ctx,
      builder: (dctx) => AlertDialog(
        backgroundColor: AppColors.surface,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        title: Text('第三方 SDK 清单',
            style: TextStyle(color: AppColors.text, fontSize: 16)),
        content: SizedBox(
          width: 480,
          child: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (final item in items) ...[
                  Text(item[0],
                      style: TextStyle(
                          fontSize: 12.5,
                          fontWeight: FontWeight.w600,
                          color: AppColors.text)),
                  Text('用途：${item[1]}',
                      style: TextStyle(
                          fontSize: 11, color: AppColors.textSub, height: 1.5)),
                  Text('处理信息：${item[2]}',
                      style: TextStyle(
                          fontSize: 11,
                          color: AppColors.textMuted,
                          height: 1.5)),
                  const SizedBox(height: 10),
                ],
                Text('以上 SDK 仅在对应功能被使用时初始化，不进行个性化广告投放。',
                    style: TextStyle(
                        fontSize: 10.5,
                        color: AppColors.textFaint,
                        height: 1.5)),
              ],
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dctx).pop(),
            child: Text('关闭', style: TextStyle(color: AppColors.cyan)),
          ),
        ],
      ),
    );
  }

  /// 反馈渠道由运营配置决定：email 展示邮箱、url 展示链接，均可一键复制。
  void _openFeedback(BuildContext ctx, AppContent content) {
    if (!content.flag('app.feedback.enabled')) {
      _snack(ctx, '反馈渠道暂未开放');
      return;
    }
    final channel = content.text('app.feedback.channel');
    final target = channel == 'url'
        ? content.text('app.feedback.url')
        : content.text('app.feedback.email');
    if (target.trim().isEmpty) {
      _snack(ctx, '反馈渠道暂未开放');
      return;
    }
    showDialog(
      context: ctx,
      builder: (dctx) => AlertDialog(
        backgroundColor: AppColors.surface,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        title: Text(
          channel == 'url' ? '反馈与举报' : '反馈邮箱',
          style: TextStyle(color: AppColors.text, fontSize: 16),
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              content.text('app.feedback.note'),
              style: TextStyle(
                  fontSize: 12.5, color: AppColors.textMuted, height: 1.6),
            ),
            const SizedBox(height: 12),
            SelectableText(
              target,
              style:
                  TextStyle(fontSize: 13, color: AppColors.text, height: 1.5),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () async {
              await Clipboard.setData(ClipboardData(text: target));
              if (!dctx.mounted) return;
              Navigator.of(dctx).pop();
              _snack(ctx, '已复制，可在外部应用中发送给我们');
            },
            child: Text('复制', style: TextStyle(color: AppColors.cyan)),
          ),
          TextButton(
            onPressed: () => Navigator.of(dctx).pop(),
            child: Text('关闭', style: TextStyle(color: AppColors.textMuted)),
          ),
        ],
      ),
    );
  }

  void _snack(BuildContext ctx, String msg) {
    ScaffoldMessenger.of(ctx).showSnackBar(SnackBar(content: Text(msg)));
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
  final AppContentDocument? document;
  const _PolicyPage({required this.title, required this.document});

  /// 纯文本按段落渲染（空行分段），不使用 HTML，避免注入与排版失控。
  List<Widget> _paragraphs() {
    final body = document?.content.trim() ?? '';
    if (body.isEmpty) {
      return [
        Icon(Icons.description_outlined, size: 40, color: AppColors.textMuted),
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
          '正文由平台在后台发布后自动同步到这里',
          textAlign: TextAlign.center,
          style:
              TextStyle(fontSize: 11, color: AppColors.textMuted, height: 1.5),
        ),
      ];
    }
    final effective = document?.effectiveDate;
    return [
      if (effective != null)
        Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: Text(
            '生效日期 ${effective.year}-${effective.month.toString().padLeft(2, '0')}-${effective.day.toString().padLeft(2, '0')}'
            ' · v${document!.version}',
            style: TextStyle(fontSize: 11, color: AppColors.textMuted),
          ),
        ),
      ...body.split(RegExp(r'\n\s*\n')).map(
            (paragraph) => Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Text(
                paragraph.trim(),
                style: TextStyle(
                    fontSize: 13, color: AppColors.textSub, height: 1.8),
              ),
            ),
          ),
    ];
  }

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
                    children: _paragraphs(),
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
