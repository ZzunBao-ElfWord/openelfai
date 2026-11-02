import 'package:flutter/material.dart';

import '../services/platform_api.dart';
import '../theme.dart';
import '../widgets/common.dart';

/// 千人千面生成器作品页：画廊（发现页入口，全量作品）/ 我的作品（「我」入口）。
///
/// 三列网格按最新优先展示缩略图，滚动到底自动翻页；
/// 点任意一件进全屏详情（双指缩放、特征组合、稀有度与种子）。
class GeneratorWorksPage extends StatefulWidget {
  /// gallery = 发现页画廊（游客可看）；mine = 我的作品（需登录）。
  final String mode;

  const GeneratorWorksPage.gallery({super.key}) : mode = 'gallery';
  const GeneratorWorksPage.mine({super.key}) : mode = 'mine';

  @override
  State<GeneratorWorksPage> createState() => _GeneratorWorksPageState();
}

class _GeneratorWorksPageState extends State<GeneratorWorksPage> {
  static const int _pageSize = 30;

  final _scroll = ScrollController();
  final List<GeneratorWork> _items = [];
  int _total = 0;
  bool _loading = true;
  bool _loadingMore = false;
  String? _error;

  bool get _isGallery => widget.mode == 'gallery';
  bool get _hasMore => _items.length < _total;

  @override
  void initState() {
    super.initState();
    _loadFirst();
    _scroll.addListener(_maybeLoadMore);
  }

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  Future<GeneratorWorkPage> _fetch({required int offset}) {
    return _isGallery
        ? PlatformApi.instance
            .fetchGeneratorFeed(limit: _pageSize, offset: offset)
        : PlatformApi.instance
            .fetchGeneratorMine(limit: _pageSize, offset: offset);
  }

  Future<void> _loadFirst() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final page = await _fetch(offset: 0);
      if (!mounted) return;
      setState(() {
        _items
          ..clear()
          ..addAll(page.items);
        _total = page.total;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = error.toString();
      });
    }
  }

  void _maybeLoadMore() {
    if (_loading || _loadingMore || !_hasMore) return;
    if (_scroll.position.pixels <
        _scroll.position.maxScrollExtent - 320) {
      return;
    }
    _loadMore();
  }

  Future<void> _loadMore() async {
    setState(() => _loadingMore = true);
    try {
      final page = await _fetch(offset: _items.length);
      if (!mounted) return;
      setState(() {
        _items.addAll(page.items);
        _total = page.total;
        _loadingMore = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _loadingMore = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: AppBackground(
        child: SafeArea(
          bottom: false,
          child: WideContent(
            maxWidth: 760,
            child: Column(
              children: [
                _topBar(),
                Expanded(child: _body()),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _topBar() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(10, 4, 16, 6),
      child: Row(
        children: [
          InkWell(
            borderRadius: BorderRadius.circular(8),
            onTap: () => Navigator.of(context).maybePop(),
            child: Padding(
              padding: const EdgeInsets.all(8),
              child: Icon(Icons.arrow_back_ios_new,
                  size: 17, color: AppColors.textSub, semanticLabel: '返回'),
            ),
          ),
          const SizedBox(width: 2),
          Text(
            _isGallery ? '作品画廊' : '我的作品',
            style: TextStyle(
                fontSize: 17,
                fontWeight: FontWeight.w700,
                color: AppColors.text),
          ),
          const Spacer(),
          Text('$_total 件',
              style: TextStyle(fontSize: 11, color: AppColors.textMuted)),
        ],
      ),
    );
  }

  Widget _body() {
    if (_loading) {
      return Center(
        child: CircularProgressIndicator(color: AppColors.cyan),
      );
    }
    if (_error != null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(_isGallery ? '画廊加载失败' : '作品加载失败',
                style: TextStyle(fontSize: 12.5, color: AppColors.textMuted)),
            const SizedBox(height: 10),
            TextButton.icon(
              onPressed: _loadFirst,
              icon: Icon(Icons.refresh, size: 16, color: AppColors.cyan),
              label:
                  Text('重试', style: TextStyle(color: AppColors.cyan)),
            ),
          ],
        ),
      );
    }
    if (_items.isEmpty) {
      return Center(
        child: Text(
          _isGallery ? '画廊还没有作品，去生成第一件吧。' : '你还没有生成器作品。',
          style: TextStyle(fontSize: 11.5, color: AppColors.textMuted),
        ),
      );
    }
    return RefreshIndicator(
      color: AppColors.cyan,
      onRefresh: _loadFirst,
      child: GridView.builder(
        controller: _scroll,
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
        gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
          crossAxisCount: 3,
          mainAxisSpacing: 8,
          crossAxisSpacing: 8,
          childAspectRatio: 0.78,
        ),
        itemCount: _items.length + (_loadingMore ? 1 : 0),
        itemBuilder: (context, index) {
          if (index >= _items.length) {
            return Center(
              child: SizedBox(
                width: 18,
                height: 18,
                child: CircularProgressIndicator(
                    strokeWidth: 2, color: AppColors.cyan),
              ),
            );
          }
          return _cell(_items[index]);
        },
      ),
    );
  }

  Widget _cell(GeneratorWork work) {
    final thumb = work.thumbUrl ?? work.imageUrl;
    return InkWell(
      borderRadius: BorderRadius.circular(12),
      onTap: () => Navigator.of(context).push(MaterialPageRoute(
          builder: (_) => _GeneratorWorkDetailPage(
              work: work, showAuthor: _isGallery))),
      child: Container(
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.strokeSoft),
        ),
        clipBehavior: Clip.antiAlias,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: SizedBox(
                width: double.infinity,
                child: thumb != null
                    ? Image.network(
                        thumb,
                        fit: BoxFit.cover,
                        errorBuilder: (_, __, ___) => _thumbFallback(),
                      )
                    : _thumbFallback(),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(8, 6, 8, 7),
              child: Row(
                children: [
                  _rarityDot(work.rarityTier),
                  const SizedBox(width: 4),
                  Expanded(
                    child: Text(
                      _isGallery
                          ? (work.authorNickname ?? '匿名')
                          : _rarityLabel(work.rarityTier),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                          fontSize: 10, color: AppColors.textMuted),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _thumbFallback() {
    return Container(
      color: AppColors.strokeSoft,
      alignment: Alignment.center,
      child: Icon(Icons.auto_awesome_outlined,
          size: 20, color: AppColors.textFaint),
    );
  }

  static Widget _rarityDot(String tier) {
    return Container(
      width: 7,
      height: 7,
      decoration:
          BoxDecoration(shape: BoxShape.circle, color: _rarityColor(tier)),
    );
  }
}

/// 稀有度配色：与形象工坊保持一致。
Color _rarityColor(String tier) => switch (tier) {
      'legendary' => AppColors.warn,
      'epic' => AppColors.violet,
      'rare' => AppColors.cyan,
      _ => AppColors.textSub,
    };

String _rarityLabel(String tier) => switch (tier) {
      'legendary' => '传说',
      'epic' => '史诗',
      'rare' => '稀有',
      _ => '普通',
    };

/// 作品详情：全屏大图（双指缩放）+ 特征组合 / 稀有度 / 种子信息。
class _GeneratorWorkDetailPage extends StatelessWidget {
  final GeneratorWork work;
  final bool showAuthor;

  const _GeneratorWorkDetailPage({required this.work, required this.showAuthor});

  @override
  Widget build(BuildContext context) {
    final image = work.imageUrl ?? work.thumbUrl;
    return Scaffold(
      backgroundColor: Colors.black,
      body: SafeArea(
        child: Stack(
          children: [
            Positioned.fill(
              child: InteractiveViewer(
                maxScale: 5,
                child: Center(
                  child: image != null
                      ? Image.network(
                          image,
                          fit: BoxFit.contain,
                          loadingBuilder: (_, child, progress) {
                            if (progress == null) return child;
                            return CircularProgressIndicator(
                                color: AppColors.cyan);
                          },
                          errorBuilder: (_, __, ___) => const Icon(
                              Icons.broken_image_outlined,
                              color: Colors.white38,
                              size: 40),
                        )
                      : const Icon(Icons.broken_image_outlined,
                          color: Colors.white38, size: 40),
                ),
              ),
            ),
            Positioned(
              top: 8,
              left: 8,
              child: IconButton(
                icon: const Icon(Icons.close, color: Colors.white),
                onPressed: () => Navigator.of(context).pop(),
              ),
            ),
            Positioned(
              left: 0,
              right: 0,
              bottom: 0,
              child: Container(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
                decoration: const BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                    colors: [Colors.transparent, Colors.black87],
                  ),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Row(
                      children: [
                        _chip(
                          '稀有度 · ${_rarityLabel(work.rarityTier)}',
                          _rarityColor(work.rarityTier),
                        ),
                        const SizedBox(width: 8),
                        _chip('评分 ${work.rarityScore}', Colors.white70),
                        if (showAuthor &&
                            (work.authorNickname?.isNotEmpty ?? false)) ...[
                          const SizedBox(width: 8),
                          _chip(work.authorNickname!, Colors.white70),
                        ],
                      ],
                    ),
                    if (work.traits.isNotEmpty) ...[
                      const SizedBox(height: 8),
                      Text(
                        work.traits
                            .map((trait) =>
                                '${trait['layer'] ?? trait['layerId'] ?? ''} · ${trait['trait'] ?? trait['traitId'] ?? ''}')
                            .join('　'),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                            fontSize: 11, color: Colors.white70, height: 1.5),
                      ),
                    ],
                    const SizedBox(height: 6),
                    Text(
                      'seed ${work.seed}'
                      '${work.createdAt != null ? ' · ${_fmtTime(work.createdAt!)}' : ''}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                          fontSize: 10, color: Colors.white38),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  static Widget _chip(String label, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withValues(alpha: 0.4)),
      ),
      child: Text(label, style: TextStyle(fontSize: 10, color: color)),
    );
  }

  static String _fmtTime(DateTime time) {
    String two(int v) => v.toString().padLeft(2, '0');
    return '${time.year}-${two(time.month)}-${two(time.day)} '
        '${two(time.hour)}:${two(time.minute)}';
  }
}
