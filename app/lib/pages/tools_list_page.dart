import 'package:flutter/material.dart';
import '../theme.dart';
import '../data/tools_repository.dart';
import '../models/tool.dart';
import 'tool_detail_page.dart';

class ToolsListPage extends StatefulWidget {
  final String? category;
  final String? region;
  final String? query;

  const ToolsListPage({super.key, this.category, this.region, this.query});

  @override
  State<ToolsListPage> createState() => _ToolsListPageState();
}

class _ToolsListPageState extends State<ToolsListPage> {
  final _repo = ToolsRepository();
  final _searchCtrl = TextEditingController();
  String? _activeCategory;
  String? _activeRegion;

  @override
  void initState() {
    super.initState();
    _activeCategory = widget.category;
    _activeRegion = widget.region;
    if (widget.query != null) {
      _searchCtrl.text = widget.query!;
    }
  }

  List<Tool> get _filteredTools {
    return _repo.search(
      _searchCtrl.text,
      category: _activeCategory,
      region: _activeRegion,
    );
  }

  String get _title {
    if (_activeCategory != null) {
      final cat = ToolsRepository.categories.firstWhere(
        (c) => c.code == _activeCategory,
        orElse: () => const CategoryInfo(code: '', name: '全部工具', icon: '', desc: ''),
      );
      return cat.name;
    }
    if (_activeRegion != null) {
      return ToolsRepository.regionLabel[_activeRegion] ?? '全部工具';
    }
    if (_searchCtrl.text.trim().isNotEmpty) {
      return '搜索结果';
    }
    return '全部工具';
  }

  @override
  Widget build(BuildContext context) {
    final tools = _filteredTools;

    return Scaffold(
      backgroundColor: AppColors.paper,
      appBar: AppBar(
        backgroundColor: AppColors.paper.withOpacity(0.92),
        surfaceTintColor: Colors.transparent,
        title: Text(_title, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600)),
        elevation: 0,
      ),
      body: Column(
        children: [
          _buildSearchHeader(),
          _buildFilterChips(),
          Expanded(
            child: tools.isEmpty
                ? _buildEmpty()
                : ListView.separated(
                    padding: const EdgeInsets.all(16),
                    itemCount: tools.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 12),
                    itemBuilder: (_, i) => _ToolCard(tool: tools[i]),
                  ),
          ),
        ],
      ),
    );
  }

  Widget _buildSearchHeader() {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
      child: TextField(
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
          contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(14),
            borderSide: BorderSide.none,
          ),
        ),
        onChanged: (_) => setState(() {}),
      ),
    );
  }

  Widget _buildFilterChips() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          children: [
            _FilterChip(
              label: '全部',
              selected: _activeCategory == null && _activeRegion == null,
              onTap: () => setState(() {
                _activeCategory = null;
                _activeRegion = null;
              }),
            ),
            const SizedBox(width: 8),
            ...ToolsRepository.categories.map((cat) => Padding(
              padding: const EdgeInsets.only(right: 8),
              child: _FilterChip(
                label: cat.name,
                selected: _activeCategory == cat.code,
                onTap: () => setState(() {
                  _activeCategory = _activeCategory == cat.code ? null : cat.code;
                  _activeRegion = null;
                }),
              ),
            )),
            _FilterChip(
              label: '国内',
              selected: _activeRegion == 'domestic',
              onTap: () => setState(() {
                _activeRegion = _activeRegion == 'domestic' ? null : 'domestic';
                _activeCategory = null;
              }),
            ),
            const SizedBox(width: 8),
            _FilterChip(
              label: '海外',
              selected: _activeRegion == 'overseas',
              onTap: () => setState(() {
                _activeRegion = _activeRegion == 'overseas' ? null : 'overseas';
                _activeCategory = null;
              }),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildEmpty() {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.search_off, size: 48, color: AppColors.inkFaint.withOpacity(0.5)),
          const SizedBox(height: 16),
          Text(
            '未找到匹配的工具',
            style: TextStyle(fontSize: 16, color: AppColors.inkFaint.withOpacity(0.7)),
          ),
          const SizedBox(height: 8),
          Text(
            '换个关键词试试',
            style: TextStyle(fontSize: 13, color: AppColors.inkFaint.withOpacity(0.5)),
          ),
        ],
      ),
    );
  }
}

class _FilterChip extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;

  const _FilterChip({required this.label, required this.selected, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(20),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
        decoration: BoxDecoration(
          color: selected ? AppColors.primary : AppColors.card,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            color: selected ? AppColors.primary : AppColors.line,
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 13,
            fontWeight: selected ? FontWeight.w600 : FontWeight.normal,
            color: selected ? Colors.white : AppColors.inkSoft,
          ),
        ),
      ),
    );
  }
}

class _ToolCard extends StatelessWidget {
  final Tool tool;
  const _ToolCard({required this.tool});

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
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _buildAvatar(),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          tool.name,
                          style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: AppColors.ink),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      const SizedBox(width: 8),
                      _RegionBadge(region: tool.region),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Text(
                    tool.shortDesc,
                    style: const TextStyle(fontSize: 13, color: AppColors.inkSoft, height: 1.5),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 10),
                  Wrap(
                    spacing: 6,
                    runSpacing: 4,
                    children: tool.tags.map((tag) => Container(
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
            const Icon(Icons.chevron_right, color: AppColors.inkFaint, size: 20),
          ],
        ),
      ),
    );
  }

  Widget _buildAvatar() {
    final bgColor = tool.region == 'domestic' ? AppColors.cnSoft : AppColors.osSoft;
    final fgColor = tool.region == 'domestic' ? AppColors.cn : AppColors.os;
    return Container(
      width: 48,
      height: 48,
      decoration: BoxDecoration(
        color: bgColor,
        borderRadius: BorderRadius.circular(12),
      ),
      alignment: Alignment.center,
      child: Text(
        tool.firstChar,
        style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: fgColor),
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
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: BoxDecoration(
        color: isDomestic ? AppColors.cnSoft : AppColors.osSoft,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        isDomestic ? '国内' : '海外',
        style: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w500,
          color: isDomestic ? AppColors.cn : AppColors.os,
        ),
      ),
    );
  }
}
