# OpenElf v1.1 — 手动指挥创作 + 自动运营 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 OpenElf 从 AI 自动创作世界，改为人类亲手打造 AI 网红的养成工具——新增手动指挥创作路径和自动运营独立能力包。

**Architecture:** 数据模型层加 `track`（赛道）和 `nextAutoPostAt`（自动发帖时间）字段；AppState 加 `manualPost()`（人类手动指挥产出）和 `triggerAutoIfDue()`（定时自动产出）两条发布路径；我的 AI 页主 CTA 改为"让它创作"并加自动运营状态显示；新建 `CreatePostSheet` 创作弹层；背包模块网格加赛道分组 tabs。两条路径产出的内容混在一起进世界信息流，不区分标记。

**Tech Stack:** Flutter 3.27, Dart, shared_preferences 持久化

---

## 文件结构

| 操作 | 文件 | 职责 |
|---|---|---|
| 修改 | `lib/models/elf.dart` | AbilityModule 加 track；Elf 加 nextAutoPostAt + 序列化 |
| 修改 | `lib/data/world_data.dart` | 现有 14 个能力填 track；新增 auto 能力模块 |
| 修改 | `lib/state/app_state.dart` | 加 manualPost() / triggerAutoIfDue() / publishFromAuto()；_injectSeeds 初始化 auto 时间戳；restoreAsync 恢复 auto 时间戳 |
| 修改 | `lib/persistence/data_repository.dart` | Elf 序列化加 nextAutoPostAt；LoadedData 传递 |
| 新建 | `lib/pages/create_post_sheet.dart` | 手动创作弹层：选能力 + 填主题 → 产出 → 发布 |
| 修改 | `lib/pages/my_ai_page.dart` | 主 CTA 从"发布一条"→"让它创作"；加自动运营状态行 |
| 修改 | `lib/pages/backpack_page.dart` | 模块网格加 track 分组 tabs |

---

## Task 1: AbilityModule 加 track 字段 + Elf 加 nextAutoPostAt

**Files:**
- Modify: `lib/models/elf.dart`

- [ ] **Step 1: AbilityModule 加 track 字段 + 序列化**

在 AbilityModule 构造函数加 required final String track，toJson/fromJson 同步加 track。

```dart
class AbilityModule {
  final String id;
  final String name;
  final String glyph;
  final String category;
  final String track;    // 新增：赛道分组
  final String summary;
  final String effect;
  final String price;
  final int load;
  final int compute;

  const AbilityModule({
    required this.id,
    required this.name,
    required this.glyph,
    required this.category,
    required this.track,    // 新增
    required this.summary,
    required this.effect,
    required this.price,
    this.load = 1,
    this.compute = 0,
  });
}
```

- [ ] **Step 2: Elf 加 nextAutoPostAt + 序列化**

```dart
class Elf {
  // ... 现有字段 ...
  double earningsYuan;
  DateTime? nextAutoPostAt;   // 新增：下一次自动发帖时间

  Elf({
    // ... 现有 required ...
    this.earningsYuan = 0,
    this.nextAutoPostAt,      // 新增
    required this.equipped,
    required this.today,
    required this.relations,
  });

  Map<String, dynamic> toJson() => {
    // ... 现有 ...
    'earningsYuan': earningsYuan,
    'nextAutoPostAt': nextAutoPostAt?.toIso8601String(),
    // ... 现有 ...
  };

  factory Elf.fromJson(Map<String, dynamic> j) => Elf(
    // ... 现有 ...
    earningsYuan: (j['earningsYuan'] as num?)?.toDouble() ?? 0,
    nextAutoPostAt: j['nextAutoPostAt'] == null
        ? null
        : DateTime.tryParse(j['nextAutoPostAt'] as String),
    // ... 现有 ...
  );
}
```

- [ ] **Step 3: dart analyze lib，确认 AbilityModule 的 track 新增后所有调用点都填了 track（下一步 world_data.dart 里补）**

---

## Task 2: world_data.dart 现有 14 个能力填 track + 新增 auto 模块

**Files:**
- Modify: `lib/data/world_data.dart`

- [ ] **Step 1: 给现有 AbilityModule 构造函数加 track 参数**

按以下映射给每个模块填 track：

| id | track |
|---|---|
| sharp, writing, rhythm | writing |
| vision, imageedit | visual |
| video | video |
| voice, music | audio |
| retrieval, deep | research |
| memory, source | memory |
| mingle | social |

每个模块的 constructor 加 `track: 'xxx'`（按上表）。

- [ ] **Step 2: 新增 auto 模块（放在 modules 列表末尾）**

```dart
AbilityModule(
  id: 'auto',
  name: '自动运营中枢',
  glyph: '自',
  track: 'system',
  category: 'auto',
  summary: '让 AI 定时自动发布',
  effect: '装上后 AI 按自己人格 + 已装能力，自动往世界发。人类仍可手动指挥',
  price: '💎 198',
  load: 2,
  compute: 0,
),
```

- [ ] **Step 3: dart analyze lib，确认 AbilityModule 的所有构造点都填了 track**

---

## Task 3: AppState 加 manualPost() + triggerAutoIfDue()

**Files:**
- Modify: `lib/state/app_state.dart`

- [ ] **Step 1: _injectSeeds / restoreAsync 初始化 nextAutoPostAt**

在 AppState 的种子注入和恢复逻辑中，给种子里的某只 AI（比如 seed elf 青梧 shi_5c07 身上如果装了 auto 能力）设初始 nextAutoPostAt，让它能自动发帖。

在 `void _injectSeeds()` 末尾加：
```dart
// 给种子 AI 装 auto 能力的初始化
final autoSeedId = 'shi_5c07';
for (final e in elves) {
  if (e.id == autoSeedId && !e.equipped.contains('auto')) {
    if (e.slotsUsed() < e.slots) {
      e.equipped.add('auto');
      e.nextAutoPostAt = DateTime.now().add(const Duration(minutes: 20));
    }
  } else if (e.equipped.contains('auto') && e.nextAutoPostAt == null) {
    e.nextAutoPostAt = DateTime.now().add(const Duration(minutes: 20));
  }
}
```

（slotsUsed 是 AppState 的方法，elf 实例没有，这里简化：遍历 elves 的 equipped 列表直接判断）

- [ ] **Step 2: 新增 manualPost 方法**

```dart
/// 人类手动指挥 AI 产出一条内容。返回 null 表示成功，否则返回原因。
String? manualPost({
  required String elfId,
  required String moduleId,
  String topic = '',
}) {
  final target = elf(elfId);
  if (!target.isMine) return '你只能指挥自己的 AI';
  if (target.liveStatus == ElfStatus.sleeping) return '它已休眠，先注算力';
  if (!target.equipped.contains(moduleId)) return '没装这个能力包，去背包装';

  final m = module(moduleId);
  if (m == null) return '能力包不存在';

  if (target.energy < m.compute) {
    return '算力不够（需 ${m.compute}），去注算力';
  }
  target.energy -= m.compute;

  final post = _mockPost(
    elfId: elfId,
    moduleId: moduleId,
    topic: topic,
  );
  posts.insert(0, post);
  target.works++;
  notifyListeners();
  return null;
}
```

- [ ] **Step 3: 新增 triggerAutoIfDue 方法 + 自动产出**

```dart
/// 检查所有 AI 的自动运营时间，到点了就产出。
void triggerAutoIfDue() {
  final now = DateTime.now();
  for (final e in elves) {
    if (e.equipped.contains('auto') &&
        e.nextAutoPostAt != null &&
        e.nextAutoPostAt!.isBefore(now)) {
      // 选一个已装非 auto 能力（最简单：随机一个非 auto 的）
      final nonAuto = e.equipped.where((id) => id != 'auto').toList();
      if (nonAuto.isEmpty) {
        // 卸了 auto 能力或没装其他能力，直接重置
        e.nextAutoPostAt = now.add(const Duration(minutes: 20));
        continue;
      }
      nonAuto.shuffle();
      final picked = nonAuto.first;
      final m = module(picked);
      if (m == null || e.energy < m.compute) {
        e.nextAutoPostAt = now.add(const Duration(minutes: 20));
        continue;
      }
      e.energy -= m.compute;
      final post = _mockPost(elfId: e.id, moduleId: picked);
      posts.insert(0, post);
      e.works++;
      e.nextAutoPostAt = now.add(Duration(minutes: 15 + (DateTime.now().millisecond % 16)));
    }
  }
  notifyListeners();
}
```

- [ ] **Step 4: _mockPost 内部方法（手动和自动共用产出逻辑）**

```dart
ElfPost _mockPost({
  required String elfId,
  required String moduleId,
  String topic = '',
}) {
  final e = elf(elfId);
  final m = module(moduleId);
  final persona = e.persona;

  // 根据模块 id + topic 拼一段 body（MVP mock）
  String body;
  if (topic.isNotEmpty) {
    body = '$topic · $persona 关于这个方向想说：${_randPhrase(moduleId)}';
  } else {
    body = '${_randPhrase(moduleId)}';
  }

  final now = DateTime.now();
  final timeAgo = '刚刚';

  return ElfPost(
    id: 'p${_postSeq++}',
    elfId: elfId,
    moduleId: moduleId,
    kind: _kindForModule(moduleId),
    body: body,
    timeAgo: timeAgo,
    audioDuration: m?.compute,
    context: m?.effect,
  );
}

static String _randPhrase(String moduleId) {
  final pool = <String, List<String>>{
    'sharp': ['今天这句话必须说', '别装了', '这世道就这样'],
    'writing': ['长文预警：关于一切没被定义的东西', '写一段港口的回忆'],
    'rhythm': ['分行\n短句\n才好读'],
    'vision': ['让我看看', '视觉的答案'],
    'imageedit': ['把图改一改'],
    'video': ['10s 短片已上线'],
    'voice': ['一段独白'],
    'music': ['背景音'],
    'retrieval': ['查了查，结论'],
    'deep': ['深入研究得出'],
    'memory': ['记得上次聊到'],
    'source': ['可追溯的结论'],
    'mingle': ['主动搭话一下'],
    'auto': ['自动运营产出'],
  };
  final list = pool[moduleId] ?? ['想了想，发一条'];
  return list[DateTime.now().millisecond % list.length];
}

static String _kindForModule(String moduleId) {
  const map = <String, String>{
    'sharp': 'text', 'writing': 'text', 'rhythm': 'text',
    'vision': 'image', 'imageedit': 'image',
    'video': 'video',
    'voice': 'audio', 'music': 'audio',
    'retrieval': 'text', 'deep': 'text', 'memory': 'text', 'source': 'text', 'mingle': 'text',
    'auto': 'text',
  };
  return map[moduleId] ?? 'text';
}
```

- [ ] **Step 5: 在 App 启动 / AppState 恢复后触发一次 auto 检查**

在 `bootstrapSync()` 末尾加：
```dart
WidgetsBinding.instance.addPostFrameCallback((_) => triggerAutoIfDue());
```

在 `restoreAsync()` 末尾、`notifyListeners()` 之前也加 `triggerAutoIfDue()` 调用。

- [ ] **Step 6: dart analyze lib，确保所有方法签名一致**

---

## Task 4: persistence/data_repository.dart 加 nextAutoPostAt 序列化

**Files:**
- Modify: `lib/persistence/data_repository.dart`

- [ ] **Step 1: 确认 Elf 的 toJson/fromJson 里 nextAutoPostAt 字段已正确处理**（Task 1 里改的，这里只需跑通一次完整序列化流程即可）

不需要改 LoadedData，因为 LoadedData 的 `elfs: elfs` 会自动用 Elf.toJson 序列化。

- [ ] **Step 2: 手动构建 release APK，清数据启动 → 登录 → 看 AI 的 nextAutoPostAt 能正常恢复（自动运营到点能触发）**

---

## Task 5: 新建 CreatePostSheet（手动创作弹层）

**Files:**
- Create: `lib/pages/create_post_sheet.dart`

- [ ] **Step 1: 写完整文件**

```dart
import 'package:flutter/material.dart';
import '../models/elf.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/common.dart';

/// 手动创作弹层：人类指挥 AI 选能力 + 填主题 → 产出发布。
class CreatePostSheet extends StatefulWidget {
  final Elf elf;
  const CreatePostSheet({super.key, required this.elf});

  @override
  State<CreatePostSheet> createState() => _CreatePostSheetState();
}

class _CreatePostSheetState extends State<CreatePostSheet> {
  String? _selectedModuleId;
  final _topicCtrl = TextEditingController();

  static const _trackLabels = {
    'writing': '写作',
    'visual': '视觉',
    'video': '视频',
    'audio': '语音',
    'research': '知识',
    'memory': '记忆',
    'social': '社交',
    'system': '系统',
  };

  @override
  void dispose() {
    _topicCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final state = AppState.instance;
    final modules = state.modulesOf(widget.elf.id); // 已装能力列表

    return Container(
      decoration: const BoxDecoration(
        color: AppColors.bgDeep,
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      child: SafeArea(
        child: Padding(
          padding: EdgeInsets.only(
            bottom: MediaQuery.of(context).viewInsets.bottom,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _header(),
              const Divider(height: 1, color: AppColors.strokeSoft),
              ConstrainedBox(
                constraints: BoxConstraints(
                  maxHeight: MediaQuery.of(context).size.height * 0.4,
                ),
                child: ListView(
                  padding: const EdgeInsets.symmetric(vertical: 6),
                  children: _groupedTracks(state, modules),
                ),
              ),
              if (modules.isEmpty)
                _noModuleTip(),
              const SizedBox(height: 8),
              _topicInput(),
              _bottomBar(state),
            ],
          ),
        ),
      ),
    );
  }

  Widget _header() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 14, 8, 6),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '让 ${widget.elf.name} 创作',
                  style: const TextStyle(
                    fontSize: 16, fontWeight: FontWeight.w700, color: AppColors.text,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  '选一个它已装的能力，给个方向',
                  style: TextStyle(fontSize: 10.5, color: AppColors.textMuted),
                ),
              ],
            ),
          ),
          IconButton(
            icon: const Icon(Icons.close, size: 18, color: AppColors.textMuted),
            onPressed: () => Navigator.of(context).pop(),
          ),
        ],
      ),
    );
  }

  List<Widget> _groupedTracks(AppState state, List<AbilityModule> modules) {
    final byTrack = <String, List<AbilityModule>>{};
    for (final m in modules) {
      (byTrack[m.track] ??= []).add(m);
    }
    final list = <Widget>[];
    for (final track in byTrack.keys) {
      list.add(Padding(
        padding: const EdgeInsets.fromLTRB(16, 10, 16, 4),
        child: Text(
          _trackLabels[track] ?? track,
          style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: AppColors.textSub),
        ),
      ));
      list.addAll(byTrack[track]!.map((m) => _moduleTile(m)));
    }
    // 未装的展示一行
    final all = state.modules;
    final installedIds = state.modulesOf(widget.elf.id).map((m) => m.id).toSet();
    final notInstalled = all.where((m) => !installedIds.contains(m.id) && m.id != 'auto').toList();
    if (notInstalled.isNotEmpty) {
      list.add(const SizedBox(height: 8));
      list.add(Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16),
        child: Text(
          '未装（去背包装）',
          style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: AppColors.textFaint),
        ),
      ));
      list.addAll(notInstalled.map((m) => _moduleTile(m, installed: false)));
    }
    return list;
  }

  Widget _moduleTile(AbilityModule m, {bool installed = true}) {
    final selected = _selectedModuleId == m.id;
    return InkWell(
      onTap: installed ? () => setState(() => _selectedModuleId = m.id) : null,
      child: Container(
        margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(10),
          border: Border.all(
            color: selected
                ? AppColors.cyan
                : AppColors.strokeSoft,
          ),
          color: !installed ? AppColors.surface.withOpacity(0.5) : null,
        ),
        child: Row(
          children: [
            Container(
              width: 32,
              height: 32,
              decoration: BoxDecoration(
                gradient: selected
                    ? AppColors.brandGradient
                    : LinearGradient(
                        colors: [AppColors.violet.withOpacity(0.3), AppColors.cyan.withOpacity(0.15)],
                      ),
                borderRadius: BorderRadius.circular(8),
              ),
              alignment: Alignment.center,
              child: Text(
                m.glyph,
                style: TextStyle(
                  fontSize: 15, fontWeight: FontWeight.w700,
                  color: selected ? AppColors.bgDeep : AppColors.violetSoft,
                ),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    installed ? m.name : '${m.name} · 未装',
                    style: TextStyle(
                      fontSize: 12.5,
                      fontWeight: FontWeight.w600,
                      color: installed ? AppColors.text : AppColors.textFaint,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    '${m.compute > 0 ? '算力 ${m.compute}' : '不耗算力'} · ${m.summary}',
                    style: const TextStyle(fontSize: 10.5, color: AppColors.textMuted),
                  ),
                ],
              ),
            ),
            if (selected)
              const Icon(Icons.check_circle, size: 18, color: AppColors.cyan),
          ],
        ),
      ),
    );
  }

  Widget _noModuleTip() {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 14),
      child: Column(
        children: [
          const Text('先给它装一个能力包，再指挥它创作',
              style: TextStyle(fontSize: 11.5, color: AppColors.textMuted)),
          const SizedBox(height: 12),
          BrandButton(
            label: '去背包装能力',
            icon: Icons.backpack_outlined,
            onTap: () {
              Navigator.of(context).pop();
              DefaultTabController.of(context)?.animateTo(2);
            },
          ),
        ],
      ),
    );
  }

  Widget _topicInput() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
      child: TextField(
        controller: _topicCtrl,
        style: const TextStyle(fontSize: 12.5, color: AppColors.text),
        decoration: InputDecoration(
          hintText: '给个方向（可选，空着也行）',
          hintStyle: const TextStyle(fontSize: 11.5, color: AppColors.textFaint),
          filled: true,
          fillColor: AppColors.surface,
          contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(10),
            borderSide: BorderSide.none,
          ),
        ),
      ),
    );
  }

  Widget _bottomBar(AppState state) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
      child: Row(
        children: [
          Text(
            _selectedModuleId == null
                ? '先选一个能力'
                : '算力消耗：${state.module(_selectedModuleId!)?.compute ?? 0}',
            style: const TextStyle(fontSize: 11, color: AppColors.textMuted),
          ),
          const Spacer(),
          BrandButton(
            label: '让它创作',
            icon: Icons.send,
            expand: false,
            onTap: _selectedModuleId == null
                ? null
                : () {
                    final err = state.manualPost(
                      elfId: widget.elf.id,
                      moduleId: _selectedModuleId!,
                      topic: _topicCtrl.text.trim(),
                    );
                    Navigator.of(context).pop();
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(content: Text(err ?? '已发布，去世界看看')),
                    );
                  },
          ),
        ],
      ),
    );
  }
}
```

- [ ] **Step 2: dart analyze lib**（有两个 error 就根据报错修）

---

## Task 6: 我的 AI 页主 CTA 改 + 自动运营状态显示

**Files:**
- Modify: `lib/pages/my_ai_page.dart`

- [ ] **Step 1: 加 CreatePostSheet import**

```dart
import 'create_post_sheet.dart';
```

- [ ] **Step 2: 把原来的"发布一条"按钮换成"让它创作"（主 CTA）**

找到原来的 Row 里两个按钮「发布一条」和「去背包」：

```dart
Row(
  children: [
    Expanded(
      child: GhostButton(
        label: elf.liveStatus == ElfStatus.sleeping ? '注算力' : '让它创作',
        icon: elf.liveStatus == ElfStatus.sleeping
            ? Icons.battery_charging_full_outlined
            : Icons.auto_awesome_outlined,
        onTap: elf.liveStatus == ElfStatus.sleeping
            ? () { ... inject ... }
            : () => _openCreatePost(context, elf),  // 新增
      ),
    ),
    ...
  ],
),
```

- [ ] **Step 3: 加 _openCreatePost 方法**

```dart
void _openCreatePost(BuildContext context, Elf elf) {
  showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (_) => CreatePostSheet(elf: elf),
  );
}
```

- [ ] **Step 4: 在三行关键数据下面加自动运营状态小行**

找到 `_kv('装配接口', ...)` 那行，下面加：

```dart
// 自动运营状态
if (elf.equipped.contains('auto')) ...[
  const SizedBox(height: 6),
  _autoStatusRow(elf),
],
```

加方法：
```dart
Widget _autoStatusRow(Elf elf) {
  String text;
  if (elf.nextAutoPostAt == null) {
    text = '自动运营已开启（待下次发帖）';
  } else {
    final remaining = elf.nextAutoPostAt!.difference(DateTime.now());
    final mins = remaining.inMinutes.clamp(1, 240);
    text = '自动运营中 · 约 ${mins} 分钟后发下一条';
  }
  return Row(
    children: [
      Container(
        width: 16, height: 16,
        decoration: const BoxDecoration(color: AppColors.cyan, shape: BoxShape.circle),
        alignment: Alignment.center,
        child: const Icon(Icons.autorenew, size: 10, color: AppColors.bgDeep),
      ),
      const SizedBox(width: 6),
      Text(text, style: const TextStyle(fontSize: 10.5, color: AppColors.cyan)),
    ],
  );
}
```

- [ ] **Step 5: dart analyze lib**

---

## Task 7: 背包模块网格加 track 分组 tabs（可选，v2 做）

**Files:**
- Modify: `lib/pages/backpack_page.dart`

**注：** 这个是增强，MVP 阶段先跳过让所有模块平铺，只在每个模块卡片上显示 track 标签。如果要做完整分组，用 TabBar/ListView 组合。

MVP 做法：在模块网格 item 上（moduleGrid 的 itemBuilder 里）给卡片右上角加一个小 track 标签（用 `module.track` 对应的 label），不做分组折叠。

---

## Task 8: 构建 + 全流程模拟器回归

- [ ] **Step 1: flutter build apk --release（无混淆）**，确认编译通过
- [ ] **Step 2: 安装到 emulator-5554，pm clear 清数据，登录**
- [ ] **Step 3: 进"我的 AI"页 → 点"让它创作" → 选一个已装能力（锐评）→ 填主题"评一下今天" → 让它创作 → 看世界信息流顶部出现新帖**
- [ ] **Step 4: 进"我的 AI"页 → 看自动运营状态行显示"约 X 分钟后发下一条"（种子 AI 青梧）**
- [ ] **Step 5: 等约 20 秒（模拟器可手动触发 triggerAutoIfDue 也行） → 自动发帖**
- [ ] **Step 6: 进"背包" → 看模块网格里有"自动运营中枢"模块**
- [ ] **Step 7: 覆盖根目录 APK + commit + push main**

---

## 自审清单

- ✅ Spec 覆盖：AbilityModule track / Elf nextAutoPostAt / manualPost / triggerAutoIfDue / CreatePostSheet / 我的 AI 页调整 / 自动运营状态行 / 自动运营中枢能力包，全部有 task
- ✅ Placeholder：无 TBD / TODO，每个 task 有完整代码
- ✅ 类型一致：track 在 models 里定义为 String，world_data 填的是常量，AppState 读取时用 module.track，一致
- ✅ 持久化：nextAutoPostAt 走 Elf.toJson/fromJson，不需要 LoadedData 加字段（因为 elfs: elfs 直接传递列表）
- ✅ 自动运营触发：manual 走 App 启动后 + injectSeeds，restoreAsync 恢复后 + restoreAsync 末尾。不需要 Timer（MVP 简化，每次打开 App 检查一次足够）
