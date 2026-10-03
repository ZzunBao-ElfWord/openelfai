import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../theme.dart';
import '../data/tools_repository.dart';
import '../models/tool.dart';

class ToolDetailPage extends StatelessWidget {
  final String toolId;

  const ToolDetailPage({super.key, required this.toolId});

  @override
  Widget build(BuildContext context) {
    final tool = ToolsRepository().getById(toolId);

    if (tool == null) {
      return Scaffold(
        backgroundColor: AppColors.paper,
        appBar: AppBar(backgroundColor: AppColors.paper, elevation: 0),
        body: const Center(child: Text('工具未找到', style: TextStyle(color: AppColors.inkSoft))),
      );
    }

    return Scaffold(
      backgroundColor: AppColors.paper,
      body: CustomScrollView(
        slivers: [
          SliverAppBar(
            floating: true,
            backgroundColor: AppColors.paper.withOpacity(0.92),
            surfaceTintColor: Colors.transparent,
            elevation: 0,
            leading: IconButton(
              icon: const Icon(Icons.arrow_back, color: AppColors.ink),
              onPressed: () => Navigator.pop(context),
            ),
          ),
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _buildHeader(tool),
                  const SizedBox(height: 24),
                  _buildInfoSection(tool),
                  const SizedBox(height: 24),
                  _buildDescription(tool),
                  const SizedBox(height: 32),
                  _buildActionButton(tool),
                  const SizedBox(height: 40),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildHeader(Tool tool) {
    final bgColor = tool.region == 'domestic' ? AppColors.cnSoft : AppColors.osSoft;
    final fgColor = tool.region == 'domestic' ? AppColors.cn : AppColors.os;

    return Row(
      children: [
        Container(
          width: 64,
          height: 64,
          decoration: BoxDecoration(
            color: bgColor,
            borderRadius: BorderRadius.circular(16),
          ),
          alignment: Alignment.center,
          child: Text(
            tool.firstChar,
            style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold, color: fgColor),
          ),
        ),
        const SizedBox(width: 18),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                tool.name,
                style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: AppColors.ink, height: 1.2),
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  _RegionBadge(region: tool.region),
                  if (tool.isFeatured) ...[
                    const SizedBox(width: 8),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                      decoration: BoxDecoration(
                        color: AppColors.accent.withOpacity(0.15),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: const Text('精选', style: TextStyle(fontSize: 11, color: AppColors.accentDark, fontWeight: FontWeight.w500)),
                    ),
                  ],
                ],
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildInfoSection(Tool tool) {
    final cat = ToolsRepository.categories.firstWhere(
      (c) => c.code == tool.category,
      orElse: () => const CategoryInfo(code: '', name: '未知分类', icon: '', desc: ''),
    );

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.line),
      ),
      child: Column(
        children: [
          _infoRow('分类', cat.name),
          const Divider(height: 24, color: AppColors.line),
          _infoRow('区域', tool.region == 'domestic' ? '国内' : '海外'),
          const Divider(height: 24, color: AppColors.line),
          _infoRow('收录时间', tool.listedAt),
          if (tool.tags.isNotEmpty) ...[
            const Divider(height: 24, color: AppColors.line),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const SizedBox(
                  width: 72,
                  child: Text('标签', style: TextStyle(fontSize: 13, color: AppColors.inkFaint)),
                ),
                Expanded(
                  child: Wrap(
                    spacing: 8,
                    runSpacing: 6,
                    children: tool.tags.map((tag) => Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                      decoration: BoxDecoration(
                        color: AppColors.paper,
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(color: AppColors.line),
                      ),
                      child: Text(tag, style: const TextStyle(fontSize: 12, color: AppColors.inkSoft)),
                    )).toList(),
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  Widget _infoRow(String label, String value) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 72,
          child: Text(label, style: const TextStyle(fontSize: 13, color: AppColors.inkFaint)),
        ),
        Expanded(
          child: Text(value, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500, color: AppColors.ink)),
        ),
      ],
    );
  }

  Widget _buildDescription(Tool tool) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('工具介绍', style: TextStyle(fontSize: 17, fontWeight: FontWeight.bold, color: AppColors.ink)),
        const SizedBox(height: 12),
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: AppColors.card,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: AppColors.line),
          ),
          child: Text(
            tool.description,
            style: const TextStyle(fontSize: 14, color: AppColors.inkSoft, height: 1.7),
          ),
        ),
      ],
    );
  }

  Widget _buildActionButton(Tool tool) {
    final isDomestic = tool.region == 'domestic';
    return SizedBox(
      width: double.infinity,
      child: ElevatedButton.icon(
        onPressed: () => _launchUrl(context, tool.entryUrl),
        icon: Icon(isDomestic ? Icons.download : Icons.open_in_new, size: 18),
        label: Text(tool.entryLabel),
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.primary,
          foregroundColor: Colors.white,
          padding: const EdgeInsets.symmetric(vertical: 16),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
        ),
      ),
    );
  }

  Future<void> _launchUrl(BuildContext context, String url) async {
    if (url.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('暂无链接')),
      );
      return;
    }
    final uri = Uri.parse(url);
    try {
      if (!await launchUrl(uri, mode: LaunchMode.externalApplication)) {
        if (context.mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('无法打开链接: $url')),
          );
        }
      }
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('打开失败: $e')),
        );
      }
    }
  }
}

class _RegionBadge extends StatelessWidget {
  final String region;
  const _RegionBadge({required this.region});

  @override
  Widget build(BuildContext context) {
    final isDomestic = region == 'domestic';
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: isDomestic ? AppColors.cnSoft : AppColors.osSoft,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        isDomestic ? '国内' : '海外',
        style: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w500,
          color: isDomestic ? AppColors.cn : AppColors.os,
        ),
      ),
    );
  }
}
