# 创建 AI · 形象预览改造 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 CreateElfPage 第 2 步「形象预览」从单张预览改为 3 列 × 2 行共 6 张方形缩略图，用户可对比挑选、点击放大、换一组时保留选中项。

**Architecture:** 仅改 `create_elf_page.dart`，将单预览状态重构为 6 槽位的 `_PreviewSlot` 列表（含 seed、preview、字节、加载/失败状态），新增选中索引。预览用 `Future.wait` 并发拉 6 次现有 `previewCharacter` 接口；换一组时按选中索引保留对应槽位、其余 5 槽换新 seed。生成大图用选中槽位的 seed+traits。新增一个点击放大的全屏 Dialog。

**Tech Stack:** Flutter / Dart，现有 `PlatformApi.previewCharacter` / `generateCharacter`，无服务端改动。

**Spec:** `docs/specs/2026-10-31-create-elf-preview-redesign.md`

---

## 文件结构

- 修改：`app/lib/pages/create_elf_page.dart` — 状态字段、预览加载/换一组/生成逻辑、第 2 步 UI、放大浮层。
- 新建测试：`app/test/create_elf_preview_logic_test.dart` — 纯逻辑测试（换一组时哪些槽位刷新）。

---

## Task 1: 抽取「换一组刷新策略」纯函数并测试

**Files:**
- Modify: `app/lib/pages/create_elf_page.dart` （在文件内新增顶层纯函数）
- Test: `app/test/create_elf_preview_logic_test.dart`

把"换一组时刷新哪些槽位"的决策从 UI 抽成可测试纯函数：给定槽位数 `n`、当前选中索引 `selected`（可为 null），返回需要重新生成 seed 的索引列表。规则：有选中时保留选中槽，其余全部刷新；无选中时全部刷新。

- [ ] **Step 1: 写失败测试**

新建 `app/test/create_elf_preview_logic_test.dart`：

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:openelf/pages/create_elf_page.dart' as cp;

void main() {
  group('previewRefreshIndices', () {
    test('无选中时全部刷新', () {
      expect(cp.previewRefreshIndices(6, null), [0, 1, 2, 3, 4, 5]);
    });

    test('有选中时保留选中，刷新其余', () {
      expect(cp.previewRefreshIndices(6, 2), [0, 1, 3, 4, 5]);
      expect(cp.previewRefreshIndices(6, 0), [1, 2, 3, 4, 5]);
      expect(cp.previewRefreshIndices(6, 5), [0, 1, 2, 3, 4]);
    });

    test('选中越界时退化为全部刷新', () {
      expect(cp.previewRefreshIndices(6, 9), [0, 1, 2, 3, 4, 5]);
      expect(cp.previewRefreshIndices(6, -1), [0, 1, 2, 3, 4, 5]);
    });
  });
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd openelfai/app && flutter test test/create_elf_preview_logic_test.dart`
Expected: 编译失败 `The function 'previewRefreshIndices' isn't defined`。

- [ ] **Step 3: 在 create_elf_page.dart 顶部实现纯函数**

在 `import` 之后、`class CreateElfPage` 之前新增：

```dart
/// 换一组时需要重新生成 seed 的槽位索引。
/// 有选中时保留选中槽，其余全部刷新；无选中或越界时全部刷新。
List<int> previewRefreshIndices(int slotCount, int? selected) {
  if (selected == null || selected < 0 || selected >= slotCount) {
    return List.generate(slotCount, (i) => i);
  }
  return List.generate(slotCount, (i) => i).where((i) => i != selected).toList();
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd openelfai/app && flutter test test/create_elf_preview_logic_test.dart`
Expected: All tests passed。

- [ ] **Step 5: Commit**

```bash
git add app/lib/pages/create_elf_page.dart app/test/create_elf_preview_logic_test.dart
git commit -m "feat(create): add preview refresh strategy helper + tests"
```

---

## Task 2: 重构预览状态为 6 槽位列表

**Files:**
- Modify: `app/lib/pages/create_elf_page.dart` （`_CreateElfPageState` 字段区、`_decodeThumb` 附近、`_loadPreview`/`_changePreview`/`_generate`）

把单预览状态换成 6 槽位结构。

- [ ] **Step 1: 新增槽位数据类与状态字段**

在 `_CreateElfPageState` 类顶部，把以下字段：

```dart
  /// 当前预览（缩略图是服务端合成的 dataUrl）。
  CharacterPreview? _preview;
  Uint8List? _previewBytes;
  int? _previewSeed;

  bool _loadingPreview = false;
  bool _generating = false;
  bool _minting = false;
```

替换为：

```dart
  /// 6 个预览槽位，3 列 × 2 行。
  static const int _previewSlotCount = 6;

  enum _SlotStatus { loading, ready, failed }

  class _PreviewSlot {
    int seed;
    CharacterPreview? preview;
    Uint8List? bytes;
    _SlotStatus status;
    _PreviewSlot({required this.seed, this.preview, this.bytes, this.status = _SlotStatus.loading});
  }

  List<_PreviewSlot> _slots = [];
  int? _selectedIndex;
  bool _loadingAll = false;   // 首次 / 全量刷新时的整页 loading
  bool _generating = false;
  bool _minting = false;
```

- [ ] **Step 2: 新增 `_buildSlots` 与 `_loadPreviews`**

替换原 `_loadPreview` 方法为：

```dart
  int _nextSeed() => Random().nextInt(0x7fffffff);

  Uint8List? _decodeThumb(String dataUrl) { /* 保持不变 */ }

  /// 为指定索引列表生成新 seed 并占位为 loading。
  void _initSlotsFor({List<int>? indices}) {
    final ids = indices ?? List.generate(_previewSlotCount, (i) => i);
    if (indices == null) {
      _slots = List.generate(_previewSlotCount, (i) => _PreviewSlot(seed: _nextSeed()));
    } else {
      for (final i in ids) {
        _slots[i] = _PreviewSlot(seed: _nextSeed());
      }
    }
  }

  /// 拉取指定槽位的预览（并发）。indices 为空时拉全部。
  Future<void> _loadPreviews({List<int>? indices}) async {
    if (_generating) return;
    final id = await _ensureDraft();
    if (!mounted || id == null) return;
    final ids = indices ?? List.generate(_previewSlotCount, (i) => i);
    final tasks = ids.map((i) async {
      try {
        final p = await PlatformApi.instance.previewCharacter(id, seed: _slots[i].seed);
        if (mounted) setState(() {
          _slots[i].preview = p;
          _slots[i].bytes = _decodeThumb(p.thumbDataUrl);
          _slots[i].status = _SlotStatus.ready;
        });
      } catch (_) {
        if (mounted) setState(() => _slots[i].status = _SlotStatus.failed);
      }
    });
    setState(() => _loadingAll = indices == null);
    await Future.wait(tasks);
    if (mounted) setState(() => _loadingAll = false);
  }
```

删除旧的单槽方法 `_loadPreview({int? seed})`（被 `_loadPreviews` 取代）。

- [ ] **Step 3: 改 `_changePreview` 与 `_generate`**

```dart
  Future<void> _changePreview() async {
    if (_loadingAll || _generating) return;
    final toRefresh = previewRefreshIndices(_previewSlotCount, _selectedIndex);
    _initSlotsFor(indices: toRefresh);
    await _loadPreviews(indices: toRefresh);
  }

  Future<void> _generate() async {
    final idx = _selectedIndex;
    final id = _draftId;
    if (idx == null || id == null || _generating) return;
    final slot = _slots[idx];
    if (slot.status != _SlotStatus.ready) return;
    setState(() => _generating = true);
    try {
      final card = await PlatformApi.instance.generateCharacter(
        id,
        seed: slot.seed,
        traits: slot.preview?.traits,
      );
      if (!mounted) return;
      setState(() {
        _card = card;
        _generating = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() => _generating = false);
      _showFailure(error);
    }
  }
```

- [ ] **Step 4: 改 `_continueFromSettings`**

```dart
  Future<void> _continueFromSettings() async {
    if (!await _validateSettings()) return;
    if (!mounted) return;
    setState(() => _step = 1);
    _selectedIndex = null;
    _initSlotsFor();
    await _loadPreviews();
  }
```

- [ ] **Step 5: 改 `_ensureDraft` 签名变化时清空选中**

在 `_ensureDraft` 的 `setState` 里、把 `_preview = null; _previewBytes = null; _previewSeed = null;` 换成：

```dart
        _selectedIndex = null;
        _slots = [];
```

两个 `setState`（正常路径和 CARD_LOCKED 重试路径）都要改。

- [ ] **Step 6: 跑静态检查**

Run: `cd openelfai/app && dart analyze lib/pages/create_elf_page.dart`
Expected: 无 error（warning 可容忍，重点看 `_preview`/`_previewBytes`/`_previewSeed`/`_loadPreview` 等旧引用是否清理干净）。

- [ ] **Step 7: Commit**

```bash
git add app/lib/pages/create_elf_page.dart
git commit -m "refactor(create): switch preview state to 6-slot list"
```

---

## Task 3: 重写第 2 步 UI 为 3×2 网格

**Files:**
- Modify: `app/lib/pages/create_elf_page.dart` （`_stepPreview`、`_previewArt`、`_rarityChip` 调用处、`_footer` 第 1 步文案）

- [ ] **Step 1: 重写 `_stepPreview`**

替换 `_stepPreview` 方法为：

```dart
  Widget _stepPreview(AppState state) {
    final generated = _card?.generated ?? false;
    final selected = _selectedIndex != null ? _slots[_selectedIndex!] : null;
    final tier = generated
        ? (_card?.rarityTier)
        : (selected?.preview?.rarityTier);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Text('形象预览',
                style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AppColors.text)),
            const Spacer(),
            if (tier != null) _rarityChip(tier),
          ],
        ),
        const SizedBox(height: 10),
        if (generated)
          _generatedImageBox()
        else
          _previewGrid(),
        const SizedBox(height: 14),
        if (!generated)
          Row(
            children: [
              _ghostChip(icon: Icons.shuffle, label: '换一组', onTap: _loadingAll || _generating ? () {} : _changePreview),
            ],
          ),
        const SizedBox(height: 14),
        Text(
          generated
              ? '形象已生成并锁定组合。形象生成免费，下一步铸造才会扣除钻石。'
              : '预览由站内形象工坊免费合成；挑一版最有感觉的，确认生成同样不收费。',
          style: TextStyle(fontSize: 10.5, height: 1.6, color: AppColors.textMuted),
        ),
        const SizedBox(height: 10),
        if (state.wallet.diamonds < AppState.createElfCost)
          Text(
            '当前余额 💎${state.wallet.diamonds}，铸造需要 💎${AppState.createElfCost}，可先去钱包充值。',
            style: TextStyle(fontSize: 10.5, color: AppColors.warn),
          ),
      ],
    );
  }
```

- [ ] **Step 2: 新增 `_previewGrid`、`_generatedImageBox`、`_slotCell`**

```dart
  Widget _generatedImageBox() {
    final url = ApiConfig.resolveAssetUrl(_card?.imageUrl);
    return Container(
      width: double.infinity,
      height: 360,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(22),
        gradient: LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight,
            colors: [AppColors.surface, AppColors.surfaceAlt]),
        border: Border.all(color: AppColors.stroke),
      ),
      clipBehavior: Clip.antiAlias,
      child: url != null
          ? ClipRRect(borderRadius: BorderRadius.circular(16),
              child: Image.network(url, fit: BoxFit.contain,
                  errorBuilder: (_, __, ___) => _fallbackArt('形象图加载失败，可换一组重试')))
          : _fallbackArt('还没有预览'),
    );
  }

  Widget _previewGrid() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(22),
        gradient: LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight,
            colors: [AppColors.surface, AppColors.surfaceAlt]),
        border: Border.all(color: AppColors.stroke),
      ),
      child: GridView.builder(
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        itemCount: _previewSlotCount,
        gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
          crossAxisCount: 3,
          crossAxisSpacing: 10,
          mainAxisSpacing: 10,
        ),
        itemBuilder: (context, i) => _slotCell(i),
      ),
    );
  }

  Widget _slotCell(int i) {
    if (i >= _slots.length) return const SizedBox.shrink();
    final slot = _slots[i];
    final selected = _selectedIndex == i;
    return GestureDetector(
      onTap: _generating ? null : () => _selectSlot(i),
      child: Container(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: selected ? AppColors.cyan : AppColors.stroke, width: selected ? 2 : 1),
        ),
        clipBehavior: Clip.antiAlias,
        child: AspectRatio(
          aspectRatio: 1,
          child: _slotContent(slot, selected),
        ),
      ),
    );
  }

  Widget _slotContent(_PreviewSlot slot, bool selected) {
    switch (slot.status) {
      case _SlotStatus.loading:
        return Center(child: SizedBox(width: 18, height: 18,
            child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.cyan)));
      case _SlotStatus.failed:
        return GestureDetector(
          onTap: () => _retrySlot(slot.seed),
          child: Center(child: Icon(Icons.refresh, size: 18, color: AppColors.textMuted)),
        );
      case _SlotStatus.ready:
        return Stack(
          fit: StackFit.expand,
          children: [
            if (slot.bytes != null)
              Image.memory(slot.bytes!, fit: BoxFit.cover, gaplessPlayback: true),
            if (selected)
              Positioned(top: 6, right: 6,
                  child: Icon(Icons.check_circle, color: AppColors.cyan, size: 18)),
          ],
        );
    }
  }
```

- [ ] **Step 3: 新增 `_selectSlot`、`_retrySlot`、放大浮层**

```dart
  void _selectSlot(int i) {
    if (i >= _slots.length || _slots[i].status != _SlotStatus.ready) return;
    setState(() {
      if (_selectedIndex == i) {
        _openZoom(i);
      } else {
        _selectedIndex = i;
      }
    });
  }

  Future<void> _retrySlot(int seed) async {
    final id = _draftId;
    if (id == null || _generating) return;
    final idx = _slots.indexWhere((s) => s.seed == seed);
    if (idx < 0) return;
    setState(() => _slots[idx].status = _SlotStatus.loading);
    try {
      final p = await PlatformApi.instance.previewCharacter(id, seed: seed);
      if (!mounted) return;
      setState(() {
        _slots[idx].preview = p;
        _slots[idx].bytes = _decodeThumb(p.thumbDataUrl);
        _slots[idx].status = _SlotStatus.ready;
      });
    } catch (_) {
      if (mounted) setState(() => _slots[idx].status = _SlotStatus.failed);
    }
  }

  Future<void> _openZoom(int i) async {
    final bytes = _slots[i].bytes;
    if (bytes == null) return;
    await showDialog<void>(
      context: context,
      builder: (ctx) => Dialog(
        backgroundColor: Colors.black87,
        insetPadding: const EdgeInsets.all(24),
        child: InteractiveViewer(
          child: Image.memory(bytes, fit: BoxFit.contain),
        ),
      ),
    );
  }
```

- [ ] **Step 4: 改底部主按钮第 1 步文案**

在 `_footer` 的 `case 1` 分支中：

```dart
      case 1:
        final generated = _card?.generated ?? false;
        final hasSelection = _selectedIndex != null;
        label = generated
            ? '下一步 · 铸造'
            : (hasSelection ? '确认生成所选形象' : '先挑一版最有感觉的');
        enabled = generated
            ? (!_loadingAll && !_generating)
            : (hasSelection && !_loadingAll && !_generating);
        break;
```

`_handlePrimary` 的 `case 1` 保持：`generated` 时进第 2 步；否则调 `_generate()`。把 `_preview == null` 分支去掉（现在始终走 `_generate`，由 `_generate` 内部判断选中）。

- [ ] **Step 5: 清理旧引用**

搜索并删除/替换所有对 `_preview`、`_previewBytes`、`_previewSeed`、`_loadPreview(`、`_loadingPreview` 的残留引用（`_stepPreview`、`_previewArt`、`_fallbackArt` 中可能仍有）。`_previewArt` 整体可删除，逻辑已并入 `_generatedImageBox`/`_slotContent`/`_fallbackArt`。

- [ ] **Step 6: 跑静态检查**

Run: `cd openelfai/app && dart analyze lib/pages/create_elf_page.dart`
Expected: 无 error。

- [ ] **Step 7: 跑全量测试**

Run: `cd openelfai/app && flutter test test/create_elf_preview_logic_test.dart test/widget_test.dart`
Expected: All tests passed。

- [ ] **Step 8: Commit**

```bash
git add app/lib/pages/create_elf_page.dart
git commit -m "feat(create): 3x2 preview grid with select + zoom + keep-on-shuffle"
```

---

## Task 4: 端到端验证

**Files:** 无代码改动，仅验证。

- [ ] **Step 1: 构建安卓调试包**

Run: `cd openelfai/app && flutter build apk --debug`
Expected: BUILD SUCCESSFUL。

- [ ] **Step 2: 安装到模拟器/真机并手测**

验证：
1. 进入创建 AI → 填完第 1 步 → 下一步，第 2 步出现 3×2 共 6 张方图，逐张加载。
2. 点选一张高亮，底部按钮变「确认生成所选形象」；再点同一张弹出可缩放大图。
3. 选一张后点「换一组」→ 选中那张保留，其余 5 张刷新。
4. 未选中时点「换一组」→ 6 张全换。
5. 单张失败可点刷新图标重试。
6. 确认生成 → 显示大图 → 下一步 → 铸造流程正常。
7. 返回第 1 步改名字 → 再回第 2 步，预览自动刷新。

- [ ] **Step 3: 跑 dart analyze 全量**

Run: `cd openelfai/app && dart analyze`
Expected: 无 error，无新增 warning（历史 warning 不算）。

---

## 自查

1. **Spec 覆盖**：6 张 3×2 网格（Task 3）、换一组保留选中（Task 1+2）、点击放大（Task 3 `_openZoom`）、未选中置灰按钮（Task 3 Step 4）、单张重试（Task 3 `_retrySlot`）、签名变化自动刷新（Task 2 Step 5）、生成用选中 seed/traits（Task 2 Step 3）——均覆盖。
2. **占位符**：无 TBD/TODO，所有代码块完整。
3. **类型一致**：`_PreviewSlot`、`_SlotStatus`、`previewRefreshIndices`、`_loadPreviews`、`_changePreview`、`_generate`、`_slots`、`_selectedIndex` 在各 Task 中命名一致。
