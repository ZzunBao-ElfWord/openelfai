import 'package:flutter/material.dart';
import '../theme.dart';
import '../data/tools_repository.dart';
import '../models/tool.dart';
import 'tools_list_page.dart';
import 'tool_detail_page.dart';

class HomePage extends StatefulWidget {
  const HomePage({super.key});

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  final _searchCtrl = TextEditingController();
  final _repo = ToolsRepository();

  @override
  Widget build(BuildContext context) {
    final counts = _repo.counts;
    final catCounts = _repo.categoryCounts;
    final featured = _repo.featured.take(6).toList();
    final latest = _repo.latest.take(6).toList();

    return Scaffold(
      backgroundColor: AppColors.paper,
      body: CustomScrollView(
        slivers: [
          _buildAppBar(),
          SliverToBoxAdapter(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _buildHero(counts),
                _buildCategoryGrid(catCounts),
                _buildSectionTitle('精选推荐', featured),
                _buildToolList(featured),
                _buildSectionTitle('最新收录', latest),
                _buildToolList(latest),
                const SizedBox(height: 32),
                _buildFooter(),
                const SizedBox(height: 24),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildAppBar() {
    return SliverAppBar(
      floating: true,
      backgroundColor: AppColors.paper.withOpacity(0.92),
      surfaceTintColor: Colors.transparent,
      title: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 32,
            height: 32,
            decoration: BoxDecoration(
              color: AppColors.primary,
              borderRadius: BorderRadius.circular(8),
            ),
            child: const Icon(Icons.auto_awesome, color: Colors.white, size: 18),
          ),
          const SizedBox(width: 10),
          const Text(
            'Openelf',
            style: TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.bold,
              color: AppColors.ink,
            ),
          ),
        ],
      ),
      actions: [
        IconButton(
          icon: const Icon(Icons.info_outline, color: AppColors.inkSoft),
          onPressed: () => _showAbout(context),
        ),
        const SizedBox(width: 8),
      ],
    );
  }

  Widget _buildHero(Map<String, int> counts) {
    return Container(
      margin: const EdgeInsets.fromLTRB(16, 8, 16, 20),
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: AppColors.primaryLight,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.primary.withOpacity(0.15)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'OPENELF · AI FIELD GUIDE',
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w600,
              color: AppColors.primary,
              letterSpacing: 1.2,
            ),
          ),
          const SizedBox(height: 12),
          const Text(
            '全球 AI 工具图鉴',
            style: TextStyle(
              fontSize: 26,
              fontWeight: FontWeight.bold,
              color: AppColors.ink,
              height: 1.2,
            ),
          ),
          const SizedBox(height: 8),
          const Text(
            '开放精灵为你整理了全球主流 AI 工具——国内工具直达下载入口，海外工具一键访问官网。',
            style: TextStyle(fontSize: 14, color: AppColors.inkSoft, height: 1.6),
          ),
          const SizedBox(height: 20),
          _buildSearchBox(),
          const SizedBox(height: 20),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: [
              _statItem(counts['total']?.toString() ?? '0', '收录工具', AppColors.primary),
              _statItem(counts['domestic']?.toString() ?? '0', '国内工具', AppColors.cn),
              _statItem(counts['overseas']?.toString() ?? '0', '海外工具', AppColors.os),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildSearchBox() {
    return TextField(
      controller: _searchCtrl,
      decoration: InputDecoration(
        hintText: '搜索 AI 工具名称或关键词',
        hintStyle: const TextStyle(color: AppColors.inkFaint, fontSize: 14),
        prefixIcon: const Icon(Icons.search, color: AppColors.inkFaint, size: 20),
        suffixIcon: ValueListenableBuilder(
          valueListenable: _searchCtrl,
          builder: (_, ctrl, __) {
            if (ctrl.text.isEmpty) return const SizedBox.shrink();
            return IconButton(
              icon: const Icon(Icons.clear, color: AppColors.inkFaint, size: 18),
              onPressed: () {
                _searchCtrl.clear();
                setState(() {});
              },
            );
          },
        ),
        filled: true,
        fillColor: Colors.white,
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: BorderSide.none,
        ),
      ),
      onSubmitted: (q) {
        if (q.trim().isNotEmpty) {
          Navigator.push(
            context,
            MaterialPageRoute(builder: (_) => ToolsListPage(query: q)),
          );
        }
      },
      onChanged: (_) => setState(() {}),
    );
  }

  Widget _statItem(String num, String label, Color color) {
    return Column(
      children: [
        Text(
          num,
          style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: color),
        ),
        const SizedBox(height: 4),
        Text(label, style: const TextStyle(fontSize: 12, color: AppColors.inkSoft)),
      ],
    );
  }

  Widget _buildCategoryGrid(Map<String, int> catCounts) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('工具分类', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: AppColors.ink)),
          const SizedBox(height: 4),
          const Text('按用途浏览 AI 工具', style: TextStyle(fontSize: 13, color: AppColors.inkSoft)),
          const SizedBox(height: 14),
          GridView.count(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            crossAxisCount: 2,
            mainAxisSpacing: 12,
            crossAxisSpacing: 12,
            childAspectRatio: 1.6,
            children: ToolsRepository.categories.map((cat) {
              final count = catCounts[cat.code] ?? 0;
              return _CategoryCard(
                cat: cat,
                count: count,
                onTap: () => Navigator.push(
                  context,
                  MaterialPageRoute(builder: (_) => ToolsListPage(category: cat.code)),
                ),
              );
            }).toList(),
          ),
        ],
      ),
    );
  }

  Widget _buildSectionTitle(String title, List<Tool> tools) {
    if (tools.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 28, 16, 12),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(title, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: AppColors.ink)),
        ],
      ),
    );
  }

  Widget _buildToolList(List<Tool> tools) {
    return SizedBox(
      height: 160,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        itemCount: tools.length,
        separatorBuilder: (_, __) => const SizedBox(width: 12),
        itemBuilder: (_, i) => SizedBox(
          width: 280,
          child: _ToolCardHorizontal(tool: tools[i]),
        ),
      ),
    );
  }

  Widget _buildFooter() {
    return Center(
      child: Column(
        children: [
          Text(
            'Openelf 开放精灵 · AI 工具图鉴',
            style: TextStyle(fontSize: 12, color: AppColors.inkFaint),
          ),
          const SizedBox(height: 4),
          Text(
            '数据来自 openelfai.com',
            style: TextStyle(fontSize: 11, color: AppColors.inkFaint.withOpacity(0.7)),
          ),
        ],
      ),
    );
  }

  void _showAbout(BuildContext context) {
    showDialog(
      context: context,
      builder: (_) => AlertDialog(
        backgroundColor: AppColors.card,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        title: const Text('关于 Openelf', style: TextStyle(fontWeight: FontWeight.bold)),
        content: const Text(
          'Openelf 开放精灵是一款 AI 工具图鉴应用，为你整理了全球主流的 AI 工具。\n\n'
          '国内工具直达下载入口，海外工具一键访问官网。\n\n'
          '当前收录 107 款 AI 工具，覆盖对话助手、图像生成、音视频、编程开发、办公效率、智能体与搜索六大领域。',
          style: TextStyle(fontSize: 14, color: AppColors.inkSoft, height: 1.6),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('知道了', style: TextStyle(color: AppColors.primary)),
          ),
        ],
      ),
    );
  }
}

class _CategoryCard extends StatelessWidget {
  final CategoryInfo cat;
  final int count;
  final VoidCallback onTap;

  const _CategoryCard({required this.cat, required this.count, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(16),
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: AppColors.card,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: AppColors.line),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Row(
              children: [
                Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(
                    color: AppColors.primaryLight,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Icon(_iconFor(cat.icon), color: AppColors.primary, size: 18),
                ),
                const Spacer(),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: AppColors.primaryLight,
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Text(
                    '$count',
                    style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AppColors.primary),
                  ),
                ),
              ],
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(cat.name, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: AppColors.ink)),
                const SizedBox(height: 2),
                Text(cat.desc, style: const TextStyle(fontSize: 11, color: AppColors.inkFaint), maxLines: 1, overflow: TextOverflow.ellipsis),
              ],
            ),
          ],
        ),
      ),
    );
  }

  IconData _iconFor(String name) {
    switch (name) {
      case 'chat_bubble': return Icons.chat_bubble_outline;
      case 'image': return Icons.image_outlined;
      case 'play_circle': return Icons.play_circle_outline;
      case 'code': return Icons.code;
      case 'work': return Icons.work_outline;
      case 'search': return Icons.search;
      default: return Icons.category;
    }
  }
}

class _ToolCardHorizontal extends StatelessWidget {
  final Tool tool;
  const _ToolCardHorizontal({required this.tool});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: () => Navigator.push(
        context,
        MaterialPageRoute(builder: (_) => ToolDetailPage(toolId: tool.id)),
      ),
      borderRadius: BorderRadius.circular(16),
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: AppColors.card,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: AppColors.line),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                _buildAvatar(),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        tool.name,
                        style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: AppColors.ink),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: 2),
                      Row(
                        children: [
                          _RegionBadge(region: tool.region),
                          if (tool.isFeatured) ...[
                            const SizedBox(width: 6),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                              decoration: BoxDecoration(
                                color: AppColors.accent.withOpacity(0.15),
                                borderRadius: BorderRadius.circular(10),
                              ),
                              child: const Text('精选', style: TextStyle(fontSize: 10, color: AppColors.accentDark, fontWeight: FontWeight.w500)),
                            ),
                          ],
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            Text(
              tool.shortDesc,
              style: const TextStyle(fontSize: 13, color: AppColors.inkSoft, height: 1.5),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
            const Spacer(),
            Wrap(
              spacing: 6,
              runSpacing: 4,
              children: tool.tags.take(3).map((tag) => Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: AppColors.paper,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: AppColors.line),
                ),
                child: Text(tag, style: const TextStyle(fontSize: 11, color: AppColors.inkSoft)),
              )).toList(),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildAvatar() {
    final bgColor = tool.region == 'domestic' ? AppColors.cnSoft : AppColors.osSoft;
    final fgColor = tool.region == 'domestic' ? AppColors.cn : AppColors.os;
    return Container(
      width: 40,
      height: 40,
      decoration: BoxDecoration(
        color: bgColor,
        borderRadius: BorderRadius.circular(10),
      ),
      alignment: Alignment.center,
      child: Text(
        tool.firstChar,
        style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: fgColor),
      ),
    );
  }
}

class _RegionBadge extends StatelessWidget {
  final String region;
  const _RegionBadge({required this.region});

  @override
  Widget build(BuildContext context) {
    final isDomestic = region == 'domestic';
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: isDomestic ? AppColors.cnSoft : AppColors.osSoft,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        isDomestic ? '国内' : '海外',
        style: TextStyle(
          fontSize: 10,
          fontWeight: FontWeight.w500,
          color: isDomestic ? AppColors.cn : AppColors.os,
        ),
      ),
    );
  }
}
