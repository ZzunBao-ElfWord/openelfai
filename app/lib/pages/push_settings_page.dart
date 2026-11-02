import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../push/push_service.dart';

class PushSettingsPage extends StatefulWidget {
  const PushSettingsPage({super.key});

  @override
  State<PushSettingsPage> createState() => _PushSettingsPageState();
}

class _PushSettingsPageState extends State<PushSettingsPage>
    with WidgetsBindingObserver {
  final _push = PushService.instance;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _push.refresh();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _push.refresh();
  }

  Future<void> _enable() async {
    final agreed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('开启消息通知'),
        content: const Text(
          '开启后，OpenElf 将使用极光推送向此设备发送通知。'
          '极光 SDK 会处理推送所需的设备、网络信息和设备注册标识。'
          '你可随时在此关闭，也可在系统设置中管理通知权限。',
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('暂不开启')),
          TextButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('同意并开启')),
        ],
      ),
    );
    if (agreed == true) await _push.enable();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('消息通知')),
        body: AnimatedBuilder(
          animation: _push,
          builder: (context, _) => ListView(
            padding: const EdgeInsets.all(20),
            children: [
              if (!_push.supported)
                const Text('当前设备暂不支持消息推送。')
              else ...[
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('接收消息通知'),
                  value: _push.enabled,
                  onChanged: _push.busy
                      ? null
                      : (value) async {
                          if (value) {
                            await _enable();
                          } else {
                            await _push.disable();
                          }
                        },
                ),
                if (_push.busy) const LinearProgressIndicator(),
                if (_push.bindingError != null) Text(_push.bindingError!),
                if (_push.error != null) ...[
                  Text(_push.error!),
                  TextButton(
                      onPressed: _push.busy ? null : () => _push.enable(),
                      child: const Text('重试')),
                ],
                if (_push.enabled) ...[
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(
                        _push.notificationsAllowed ? '系统通知权限已开启' : '系统通知权限未开启'),
                    trailing: TextButton(
                        onPressed: _push.openSystemSettings,
                        child: const Text('系统设置')),
                  ),
                  const SizedBox(height: 16),
                  const Text('通知连接状态'),
                  const SizedBox(height: 8),
                  Text(_push.registrationId.isEmpty
                      ? '正在连接通知服务，请稍后刷新'
                      : _push.bindingError != null
                          ? '通知连接待恢复'
                          : _push.accountBound
                              ? '设备已连接通知服务'
                              : '等待连接通知服务'),
                  Wrap(spacing: 8, children: [
                    TextButton(
                        onPressed: _push.refresh, child: const Text('刷新状态')),
                    TextButton(
                      onPressed: _push.registrationId.isEmpty
                          ? null
                          : () async {
                              await Clipboard.setData(
                                  ClipboardData(text: _push.registrationId));
                              if (context.mounted) {
                                ScaffoldMessenger.of(context).showSnackBar(
                                    const SnackBar(content: Text('设备推送标识已复制')));
                              }
                            },
                      child: const Text('复制诊断信息'),
                    ),
                  ]),
                  if (_push.lastEvent != null) Text(_push.lastEvent!),
                ],
              ],
            ],
          ),
        ),
      );
}
