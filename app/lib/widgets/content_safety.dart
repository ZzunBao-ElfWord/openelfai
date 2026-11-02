import 'package:flutter/material.dart';
import '../compliance/community_repository.dart';
import '../state/app_state.dart';

const communityRules = '''社区规范（2026-10-28）
不得发布色情、性剥削、暴力威胁、仇恨、骚扰、诈骗、垃圾广告或其他违法内容；不得冒用他人身份、侵犯肖像、隐私或知识产权。不得生成或传播涉及未成年人的色情内容。
你应当拥有输入素材和发布作品的必要授权。AI 输出可能错误或不适当，请勿将其视为专业意见；不得利用 AI 制作有害、欺骗或侵权内容。
帖子与评论正常发布后默认展示，不以人工审核批准作为展示条件；这不代表平台已审核或保证内容安全。违规内容可被下架，严重或重复违规账号可被限制使用。
在内容或 AI 页的“举报与屏蔽”入口提交举报。举报保存在服务端并提供回执和处理状态。屏蔽后不再向你展示相关 AI 或用户的内容；可在设置中解除。
我们应及时处理举报，目标为24小时内响应；紧急违法及未成年人安全问题优先处理。你可通过设置→内容安全与反馈申诉，或联系 support@openelfai.com。请勿提交与问题无关的敏感信息。
屏蔽不影响你依法享有的权益，也不会自动删除交易或他人的内容。处理不当时可通过反馈提出申诉。''';

class ContentSafety {
  static Future<void> show(BuildContext context,
      {required String targetKind,
      required String targetId,
      String? elfId,
      String? ownerId}) async {
    final state = AppState.instance;
    if (state.currentUser == null) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('请先登录再举报或屏蔽')));
      return;
    }
    final action = await showModalBottomSheet<String>(
        context: context,
        builder: (ctx) => SafeArea(
                child: Column(mainAxisSize: MainAxisSize.min, children: [
              ListTile(
                  leading: const Icon(Icons.flag_outlined),
                  title: const Text('举报内容'),
                  onTap: () => Navigator.pop(ctx, 'report')),
              if (elfId != null && !state.elf(elfId).isMine)
                ListTile(
                    leading: const Icon(Icons.visibility_off_outlined),
                    title: const Text('屏蔽此 AI'),
                    onTap: () => Navigator.pop(ctx, 'elf')),
              if (ownerId != null &&
                  ownerId.startsWith('u_') &&
                  ownerId != state.currentUser?.id)
                ListTile(
                    leading: const Icon(Icons.block),
                    title: const Text('屏蔽此用户及其内容'),
                    onTap: () => Navigator.pop(ctx, 'user')),
              ListTile(
                  title: const Text('取消'), onTap: () => Navigator.pop(ctx)),
            ])));
    if (!context.mounted || action == null) return;
    if (action == 'report') {
      await report(context, targetKind: targetKind, targetId: targetId);
      return;
    }
    final confirmed = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
                title: const Text('确认屏蔽？'),
                content: const Text('屏蔽后不再向你展示相关内容。可在设置→内容安全与反馈中解除。'),
                actions: [
                  TextButton(
                      onPressed: () => Navigator.pop(ctx, false),
                      child: const Text('取消')),
                  TextButton(
                      onPressed: () => Navigator.pop(ctx, true),
                      child: const Text('屏蔽'))
                ]));
    if (confirmed != true || !context.mounted) return;
    final error = await state.setCommunityBlock(
        action, action == 'elf' ? elfId! : ownerId!, true);
    if (context.mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(error ?? '已屏蔽，可在设置中解除')));
    }
  }

  static Future<void> report(BuildContext context,
      {required String targetKind, required String targetId}) async {
    final id = await showDialog<String>(
        context: context,
        builder: (_) =>
            _ReportDialog(targetKind: targetKind, targetId: targetId));
    if (context.mounted && id != null) {
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('已提交，回执：$id。可在设置中查看处理状态。')));
    }
  }
}

class _ReportDialog extends StatefulWidget {
  const _ReportDialog({required this.targetKind, required this.targetId});
  final String targetKind;
  final String targetId;
  @override
  State<_ReportDialog> createState() => _ReportDialogState();
}

class _ReportDialogState extends State<_ReportDialog> {
  final _details = TextEditingController();
  String _reason = '其他';
  String _requestId = CommunityRepository.requestId();
  bool _busy = false;
  String? _error;
  @override
  void dispose() {
    _details.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_busy) return;
    if (widget.targetKind == 'feedback' && _details.text.trim().isEmpty) {
      setState(() => _error = '请填写反馈内容');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    final state = AppState.instance;
    final error = await state.report(
        targetId: '${widget.targetKind}:${widget.targetId}',
        reason: _reason,
        details: _details.text.trim(),
        requestId: _requestId);
    if (!mounted) return;
    if (error != null) {
      setState(() {
        _busy = false;
        _error = error;
      });
      return;
    }
    Navigator.pop(context, state.reports.first['id']);
  }

  @override
  Widget build(BuildContext context) => PopScope(
      canPop: !_busy,
      child: AlertDialog(
        title: Text(widget.targetKind == 'feedback' ? '反馈或申诉' : '提交举报'),
        content: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, children: [
          DropdownButtonFormField<String>(
              initialValue: _reason,
              decoration: const InputDecoration(labelText: '原因'),
              items: const [
                '色情或低俗',
                '侮辱或攻击',
                '违法违规',
                '垃圾广告',
                '侵权或冒用',
                'AI有害内容',
                '其他'
              ].map((r) => DropdownMenuItem(value: r, child: Text(r))).toList(),
              onChanged: _busy
                  ? null
                  : (value) => setState(() {
                        _reason = value!;
                        _requestId = CommunityRepository.requestId();
                      })),
          TextField(
              controller: _details,
              enabled: !_busy,
              maxLength: 1000,
              maxLines: 4,
              decoration: const InputDecoration(
                  labelText: '补充说明（反馈必填）', hintText: '请勿填写身份证、密码等敏感信息'),
              onChanged: (_) => _requestId = CommunityRepository.requestId()),
          if (_error != null)
            Text(_error!,
                style: TextStyle(color: Theme.of(context).colorScheme.error)),
        ])),
        actions: [
          TextButton(
              onPressed: _busy ? null : () => Navigator.pop(context),
              child: const Text('取消')),
          FilledButton(
              onPressed: _busy ? null : _submit,
              child: Text(_busy ? '提交中…' : '提交'))
        ],
      ));
}
