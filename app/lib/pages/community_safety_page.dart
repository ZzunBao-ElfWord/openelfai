import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../compliance/community_repository.dart';
import '../state/app_state.dart';
import '../widgets/content_safety.dart';

class CommunitySafetyPage extends StatefulWidget {
  const CommunitySafetyPage({super.key});
  @override
  State<CommunitySafetyPage> createState() => _CommunitySafetyPageState();
}

class _CommunitySafetyPageState extends State<CommunitySafetyPage> {
  final _state = AppState.instance;
  String? _error;
  bool _busy = false;
  bool _consent = false;
  @override
  void initState() {
    super.initState();
    _refresh();
  }

  Future<void> _refresh() async {
    setState(() => _busy = true);
    final error = await _state.refreshCommunity();
    if (mounted) {
      setState(() {
        _error = error;
        _busy = false;
      });
    }
  }

  Future<void> _accept() async {
    setState(() => _busy = true);
    try {
      await CommunityRepository.instance.acceptTerms(_state.communityMode);
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('已记录同意社区规范，内容提交后仍需审核')));
      }
    } catch (_) {
      if (mounted) setState(() => _error = '同意记录未确认，请重试');
    }
    if (mounted) setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) => Scaffold(
      appBar: AppBar(title: const Text('内容安全与反馈')),
      body: AnimatedBuilder(
          animation: _state,
          builder: (context, _) =>
              ListView(padding: const EdgeInsets.all(16), children: [
                const SelectableText(communityRules),
                CheckboxListTile(
                    value: _consent,
                    onChanged: _busy
                        ? null
                        : (v) => setState(() => _consent = v ?? false),
                    title: const Text('我已阅读并同意社区规范'),
                    contentPadding: EdgeInsets.zero),
                FilledButton(
                    onPressed: !_busy && _consent && _state.currentUser != null
                        ? _accept
                        : null,
                    child: const Text('保存同意记录')),
                const SizedBox(height: 12),
                OutlinedButton(
                    onPressed: _busy
                        ? null
                        : () => ContentSafety.report(context,
                            targetKind: 'feedback', targetId: 'feedback'),
                    child: const Text('提交反馈或申诉')),
                TextButton(
                    onPressed: () async {
                      await Clipboard.setData(
                          const ClipboardData(text: 'support@openelfai.com'));
                      if (context.mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('联系邮箱已复制')));
                      }
                    },
                    child: const Text('联系邮箱：support@openelfai.com（点击复制）')),
                if (_error != null)
                  Text(_error!,
                      style: TextStyle(
                          color: Theme.of(context).colorScheme.error)),
                TextButton(
                    onPressed: _busy ? null : _refresh,
                    child: Text(_busy ? '加载中…' : '刷新处理状态')),
                const Divider(),
                Text('我的举报与反馈', style: Theme.of(context).textTheme.titleMedium),
                if (_state.reports.isEmpty) const Text('暂无记录；仅在服务端确认后显示提交成功。'),
                ..._state.reports.map((r) => ListTile(
                    title: Text(r['reason'] ?? '举报'),
                    subtitle: SelectableText(
                        '回执：${r['id']}\n${r['resolution'] ?? ''}'),
                    trailing: Text(switch (r['status']) {
                      'pending' => '待处理',
                      'hidden' => '已下架',
                      'dismissed' => '已回复',
                      _ => '已处理'
                    }))),
                const Divider(),
                Text('屏蔽名单', style: Theme.of(context).textTheme.titleMedium),
                if (_state.communityBlocks.isEmpty) const Text('暂无屏蔽对象'),
                ..._state.communityBlocks.map((b) => ListTile(
                    title: Text(b['label'] ?? '用户或AI'),
                    subtitle: Text(b['targetKind'] == 'elf' ? 'AI' : '用户'),
                    trailing: TextButton(
                        onPressed: _busy
                            ? null
                            : () async {
                                setState(() => _busy = true);
                                final error = await _state.setCommunityBlock(
                                    b['targetKind'], b['targetId'], false);
                                if (mounted) {
                                  setState(() {
                                    _busy = false;
                                    _error = error;
                                  });
                                }
                              },
                        child: const Text('解除屏蔽')))),
              ])));
}
