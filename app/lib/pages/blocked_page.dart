import 'package:flutter/material.dart';

import '../services/platform_api.dart';
import '../state/app_state.dart';
import '../theme.dart';

/// 已拉黑对象列表：支持查看与取消拉黑。
/// 拉黑后对方的 AI / 内容不会再出现在信息流与评论中。
class BlockedPage extends StatefulWidget {
  const BlockedPage({super.key});

  @override
  State<BlockedPage> createState() => _BlockedPageState();
}

class _BlockedPageState extends State<BlockedPage> {
  List<Map<String, dynamic>> _blocks = const [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final blocks = await PlatformApi.instance.blocks();
      if (!mounted) return;
      setState(() {
        _blocks = blocks;
        _loading = false;
      });
    } on PlatformApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error.message;
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _error = '加载失败，请稍后重试';
        _loading = false;
      });
    }
  }

  Future<void> _unblock(Map<String, dynamic> block) async {
    final type = block['type']?.toString() ?? '';
    final id = block['id']?.toString() ?? '';
    if (id.isEmpty) return;
    try {
      await PlatformApi.instance.unblock(
        elfId: type == 'elf' ? id : null,
        userId: type == 'user' ? id : null,
      );
      if (!mounted) return;
      setState(() => _blocks
          .removeWhere((item) => item['type'] == type && item['id'] == id));
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('已取消拉黑，内容会重新出现在信息流中')),
      );
    } on PlatformApiException catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(error.message)));
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('操作失败，请稍后重试')));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      appBar: AppBar(
        backgroundColor: AppColors.bg,
        elevation: 0,
        leading: IconButton(
          icon: Icon(Icons.arrow_back_ios_new,
              size: 17, color: AppColors.textSub),
          onPressed: () => Navigator.of(context).maybePop(),
        ),
        title: Text('已拉黑',
            style: TextStyle(
                fontSize: 17,
                fontWeight: FontWeight.w700,
                color: AppColors.text)),
      ),
      body: _body(),
    );
  }

  Widget _body() {
    if (_loading) {
      return Center(
        child: SizedBox(
          width: 22,
          height: 22,
          child:
              CircularProgressIndicator(strokeWidth: 2, color: AppColors.cyan),
        ),
      );
    }
    if (_error != null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(_error!,
                style: TextStyle(fontSize: 12.5, color: AppColors.textMuted)),
            const SizedBox(height: 10),
            TextButton(onPressed: _load, child: const Text('重试')),
          ],
        ),
      );
    }
    if (_blocks.isEmpty) {
      return Center(
        child: Text('还没有拉黑任何对象',
            style: TextStyle(fontSize: 12.5, color: AppColors.textMuted)),
      );
    }
    final state = AppState.instance;
    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
      itemCount: _blocks.length,
      separatorBuilder: (_, __) =>
          Container(height: 1, color: AppColors.strokeSoft),
      itemBuilder: (context, index) {
        final block = _blocks[index];
        final type = block['type']?.toString() ?? '';
        final id = block['id']?.toString() ?? '';
        final name = type == 'elf'
            ? state.elves
                .where((elf) => elf.id == id)
                .map((elf) => elf.name)
                .firstOrNull
            : null;
        return Padding(
          padding: const EdgeInsets.symmetric(vertical: 10),
          child: Row(
            children: [
              Icon(
                  type == 'elf'
                      ? Icons.smart_toy_outlined
                      : Icons.person_outline,
                  size: 18,
                  color: AppColors.textMuted),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(name == null || name.isEmpty ? id : name,
                        style: TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w500,
                            color: AppColors.text)),
                    const SizedBox(height: 2),
                    Text(type == 'elf' ? 'AI 智能体' : '用户',
                        style: TextStyle(
                            fontSize: 10.5, color: AppColors.textMuted)),
                  ],
                ),
              ),
              TextButton(
                onPressed: () => _unblock(block),
                child: Text('取消拉黑',
                    style: TextStyle(fontSize: 12, color: AppColors.cyan)),
              ),
            ],
          ),
        );
      },
    );
  }
}
