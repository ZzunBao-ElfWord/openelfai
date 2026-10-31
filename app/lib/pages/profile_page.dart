import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../config/commerce_config.dart';
import '../data/world_data.dart';
import '../models/user.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'api_key_page.dart';
import 'bookshelf_page.dart';
import 'earnings_page.dart';
import 'login_page.dart';
import 'my_elves_page.dart';
import 'settings_page.dart';
import 'wallet_page.dart';

/// 「我」tab：WorkBuddy 式的简单账户页。
///
/// 顶部居中标题，下面两张圆角卡片：
/// 账户卡（头像/昵称、人类地址、钻石余额与充值），
/// 功能卡（我的 AI、收益、仓库、API Key、设置）。
/// 充值只在这里，不再出现在其他页面。
class ProfilePage extends StatefulWidget {
  const ProfilePage({super.key});

  @override
  State<ProfilePage> createState() => _ProfilePageState();
}

class _ProfilePageState extends State<ProfilePage> {
  AppState get _state => AppState.instance;

  void _push(Widget page) {
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => page));
  }

  @override
  Widget build(BuildContext context) {
    final state = _state;
    return AppBackground(
      child: SafeArea(
        bottom: false,
        child: AnimatedBuilder(
          animation: state,
          builder: (context, _) {
            final user = state.currentUser;
            return WideContent(
              maxWidth: 760,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(16, 18, 16, 28),
                children: [
                  Center(
                    child: Text(
                      '我的',
                      style: TextStyle(
                        fontSize: 17,
                        fontWeight: FontWeight.w600,
                        letterSpacing: 0.5,
                        color: AppColors.text,
                      ),
                    ),
                  ),
                  const SizedBox(height: 20),
                  _accountCard(state, user),
                  const SizedBox(height: 14),
                  _menuCard(state),
                ],
              ),
            );
          },
        ),
      ),
    );
  }

  // —— 账户卡：身份 + 地址 + 余额充值 ——

  Widget _accountCard(AppState state, User? user) {
    final addr = user?.chainAddress ?? '';
    final short = addr.length > 13
        ? '${addr.substring(0, 6)}…${addr.substring(addr.length - 4)}'
        : addr;

    return _card(divided: true, rows: [
      InkWell(
        onTap: user == null
            ? () => _push(const LoginPage())
            : null,
        child: _row(
          leading: Container(
            width: 38,
            height: 38,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              gradient: AppColors.brandGradient,
            ),
            alignment: Alignment.center,
            child: Text(
              user?.avatarInitial ?? '?',
              style: TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w700,
                color: AppColors.onBrand,
              ),
            ),
          ),
          label: user?.nickname ?? '未登录',
          trailing: user == null
              ? _pill('去登录')
              : Text(
                  _maskPhone(user.phone),
                  style: TextStyle(fontSize: 11.5, color: AppColors.textMuted),
                ),
        ),
      ),
      _row(
        label: '人类地址',
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              short.isEmpty ? '——' : short,
              style: TextStyle(
                fontSize: 11.5,
                color: AppColors.textSub,
                fontFamily: 'monospace',
              ),
            ),
            if (addr.isNotEmpty) ...[
              const SizedBox(width: 6),
              InkWell(
                borderRadius: BorderRadius.circular(6),
                onTap: () {
                  Clipboard.setData(ClipboardData(text: addr));
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                      content: Text('已复制我的人类地址'),
                      duration: Duration(seconds: 2),
                    ),
                  );
                },
                child: Icon(Icons.copy_outlined,
                    size: 13,
                    color: AppColors.textMuted,
                    semanticLabel: '复制我的人类地址'),
              ),
            ],
          ],
        ),
      ),
      _row(
        label: '钻石余额',
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              '💎 ${state.wallet.diamonds}',
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: AppColors.cyan,
                fontFeatures: const [FontFeature.tabularFigures()],
              ),
            ),
            const SizedBox(width: 8),
            _pill(
              '充值',
              onTap: () {
                if (!checkLoginOrPrompt(context)) return;
                _push(const WalletPage());
              },
            ),
          ],
        ),
      ),
    ]);
  }

  // —— 功能卡：入口列表 ——

  Widget _menuCard(AppState state) {
    final earnings = CommerceConfig.enabled
        ? state.creatorEarningsYuan
        : state.myElves.fold<double>(0, (sum, e) => sum + e.earningsYuan);
    return _card(rows: [
      _row(
        label: '我的 AI',
        value: state.myElves.isEmpty ? '去创建' : '${state.myElves.length} 只',
        chevron: true,
        onTap: () {
          if (!checkLoginOrPrompt(context)) return;
          _push(const MyElvesPage());
        },
      ),
      _row(
        label: '收益',
        value: WorldData.formatYuan(earnings),
        chevron: true,
        onTap: () {
          if (!checkLoginOrPrompt(context)) return;
          _push(const EarningsPage());
        },
      ),
      _row(
        label: '仓库',
        value: '${state.books.length} 本',
        chevron: true,
        onTap: () {
          if (!checkLoginOrPrompt(context)) return;
          _push(const BookshelfPage());
        },
      ),
      _row(
        label: '我的 API Key',
        chevron: true,
        onTap: () {
          if (!checkLoginOrPrompt(context)) return;
          _push(const ApiKeyPage());
        },
      ),
      _row(
        label: '设置',
        chevron: true,
        onTap: () => _push(const SettingsPage()),
      ),
    ]);
  }

  // —— 公共小组件 ——

  Widget _card({required List<Widget> rows, bool divided = false}) {
    return Material(
      color: AppColors.surface,
      borderRadius: BorderRadius.circular(16),
      clipBehavior: Clip.antiAlias,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (var i = 0; i < rows.length; i++) ...[
            if (divided && i > 0)
              Divider(height: 1, thickness: 1, color: AppColors.strokeSoft),
            rows[i],
          ],
        ],
      ),
    );
  }

  Widget _row({
    required String label,
    Widget? leading,
    String? value,
    Widget? trailing,
    bool chevron = false,
    VoidCallback? onTap,
  }) {
    final content = Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 15),
      child: Row(
        children: [
          if (leading != null) ...[
            leading,
            const SizedBox(width: 12),
          ],
          Expanded(
            child: Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w500,
                color: AppColors.text,
              ),
            ),
          ),
          if (value != null)
            Text(
              value,
              style: TextStyle(fontSize: 12, color: AppColors.textMuted),
            ),
          if (trailing != null) ...[
            const SizedBox(width: 8),
            trailing,
          ],
          if (chevron) ...[
            const SizedBox(width: 4),
            Icon(Icons.chevron_right, size: 20, color: AppColors.textMuted),
          ],
        ],
      ),
    );
    if (onTap == null) return content;
    return InkWell(onTap: onTap, child: content);
  }

  Widget _pill(String label, {VoidCallback? onTap}) {
    return InkWell(
      borderRadius: BorderRadius.circular(999),
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: AppColors.stroke),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w600,
            color: AppColors.textSub,
          ),
        ),
      ),
    );
  }

  static String _maskPhone(String phone) {
    if (phone.length < 7) return phone;
    return '${phone.substring(0, 3)}****${phone.substring(phone.length - 4)}';
  }
}
