import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../models/elf.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/common.dart';

/// 上传 AI 生成视频：只接收视频文件，且必须由上传者声明内容由 AI 生成。
/// 发布后与世界信息流、视频信息流共用同一条内容。
class UploadVideoSheet extends StatefulWidget {
  const UploadVideoSheet({super.key});

  @override
  State<UploadVideoSheet> createState() => _UploadVideoSheetState();
}

class _UploadVideoSheetState extends State<UploadVideoSheet> {
  static const _maxBytes = 20 * 1024 * 1024;

  final _picker = ImagePicker();
  final _caption = TextEditingController();

  String? _elfId;
  Uint8List? _bytes;
  String _fileName = '';
  bool _aiDeclared = false;
  bool _submitting = false;

  @override
  void initState() {
    super.initState();
    _elfId = AppState.instance.myElf?.id;
  }

  @override
  void dispose() {
    _caption.dispose();
    super.dispose();
  }

  void _toast(String text) {
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(text)));
  }

  /// MP4/MOV 等 ISO-BMFF 容器第 4-8 字节固定为 ftyp，
  /// 用它挡掉改名成视频的图片，和服务端的校验保持一致。
  bool _looksLikeVideo(Uint8List bytes) {
    if (bytes.length < 12) return false;
    return String.fromCharCodes(bytes.sublist(4, 8)) == 'ftyp';
  }

  Future<void> _pickVideo() async {
    try {
      final file = await _picker.pickVideo(
        source: ImageSource.gallery,
        maxDuration: const Duration(seconds: 60),
      );
      if (file == null || !mounted) return;
      final bytes = await file.readAsBytes();
      if (!mounted) return;
      if (!_looksLikeVideo(bytes)) {
        _toast('仅支持视频文件（MP4）');
        return;
      }
      if (bytes.lengthInBytes > _maxBytes) {
        _toast('视频不能超过 20MB');
        return;
      }
      setState(() {
        _bytes = bytes;
        _fileName = file.name;
      });
    } catch (_) {
      if (!mounted) return;
      _toast('无法打开相册，请检查权限后重试');
    }
  }

  Future<void> _submit() async {
    if (_submitting) return;
    final elfId = _elfId;
    if (elfId == null) {
      _toast('先创建或持有一只 AI，再上传它的视频');
      return;
    }
    final bytes = _bytes;
    if (bytes == null) {
      _toast('请选择 AI 生成的视频');
      return;
    }
    if (_caption.text.trim().isEmpty) {
      _toast('请填写视频文案');
      return;
    }
    if (!_aiDeclared) {
      _toast('请先确认该视频由 AI 生成');
      return;
    }
    setState(() => _submitting = true);
    final err = await AppState.instance.uploadAiVideo(
      elfId: elfId,
      caption: _caption.text,
      bytes: bytes,
    );
    if (!mounted) return;
    setState(() => _submitting = false);
    if (err != null) {
      _toast(err);
      return;
    }
    Navigator.of(context).pop();
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('已发布，视频会出现在世界与视频信息流')),
    );
  }

  @override
  Widget build(BuildContext context) {
    final state = AppState.instance;
    final myElves = state.myElves;
    return Container(
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(16)),
      ),
      child: SafeArea(
        child: Padding(
          padding: EdgeInsets.only(
            bottom: MediaQuery.of(context).viewInsets.bottom,
          ),
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 16),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _header(),
                Divider(height: 20, color: AppColors.strokeSoft),
                _sectionLabel('发布到哪只 AI'),
                const SizedBox(height: 8),
                myElves.isEmpty ? _noElf() : _elfChips(myElves),
                const SizedBox(height: 16),
                _sectionLabel('AI 生成的视频'),
                const SizedBox(height: 8),
                _videoPicker(),
                const SizedBox(height: 16),
                _sectionLabel('视频文案'),
                const SizedBox(height: 8),
                _captionInput(),
                const SizedBox(height: 12),
                _declaration(),
                const SizedBox(height: 16),
                BrandButton(
                  label: _submitting ? '正在上传…' : '发布视频',
                  icon: Icons.upload_outlined,
                  onTap: (_submitting || myElves.isEmpty) ? null : _submit,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _header() {
    return Row(
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                '上传 AI 视频',
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                  color: AppColors.text,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                '仅支持 AI 生成的内容 · 视频格式',
                style: TextStyle(fontSize: 10.5, color: AppColors.textMuted),
              ),
            ],
          ),
        ),
        IconButton(
          icon: Icon(Icons.close, size: 18, color: AppColors.textMuted),
          onPressed: () => Navigator.of(context).pop(),
        ),
      ],
    );
  }

  Widget _sectionLabel(String text) {
    return Text(
      text,
      style: TextStyle(
        fontSize: 11,
        fontWeight: FontWeight.w600,
        color: AppColors.textSub,
      ),
    );
  }

  Widget _noElf() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.strokeSoft),
      ),
      child: Text(
        '你还没有 AI。先在底栏「创建」里创建一只，视频要挂在它的名下。',
        style: TextStyle(fontSize: 11.5, color: AppColors.textMuted, height: 1.6),
      ),
    );
  }

  Widget _elfChips(List<Elf> myElves) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: myElves.map((elf) {
          final selected = _elfId == elf.id;
          return Padding(
            padding: const EdgeInsets.only(right: 8),
            child: GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTap: () => setState(() => _elfId = elf.id),
              child: Container(
                padding: const EdgeInsets.fromLTRB(6, 5, 12, 5),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(
                    color: selected ? AppColors.cyan : AppColors.strokeSoft,
                  ),
                  color: selected
                      ? AppColors.cyan.withOpacity(0.1)
                      : Colors.transparent,
                ),
                child: Row(
                  children: [
                    ElfAvatar(elf: elf, size: 24),
                    const SizedBox(width: 7),
                    Text(
                      elf.name,
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color: selected ? AppColors.cyan : AppColors.textSub,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          );
        }).toList(),
      ),
    );
  }

  Widget _videoPicker() {
    final bytes = _bytes;
    return InkWell(
      onTap: _submitting ? null : _pickVideo,
      borderRadius: BorderRadius.circular(10),
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(vertical: 18, horizontal: 14),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(10),
          border: Border.all(
            color: bytes == null ? AppColors.strokeSoft : AppColors.cyan,
          ),
          color: bytes == null
              ? AppColors.surface
              : AppColors.cyan.withOpacity(0.08),
        ),
        child: bytes == null
            ? Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.video_library_outlined,
                      size: 18, color: AppColors.textMuted),
                  const SizedBox(width: 8),
                  Text(
                    '从相册选择 AI 生成的视频',
                    style: TextStyle(fontSize: 12.5, color: AppColors.textSub),
                  ),
                ],
              )
            : Row(
                children: [
                  Icon(Icons.movie_outlined, size: 20, color: AppColors.cyan),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          _fileName,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                            color: AppColors.text,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          '${(bytes.lengthInBytes / 1024 / 1024).toStringAsFixed(1)}MB · 点击重新选择',
                          style: TextStyle(
                              fontSize: 10.5, color: AppColors.textMuted),
                        ),
                      ],
                    ),
                  ),
                  Icon(Icons.check_circle, size: 18, color: AppColors.cyan),
                ],
              ),
      ),
    );
  }

  Widget _captionInput() {
    return TextField(
      controller: _caption,
      enabled: !_submitting,
      maxLength: 200,
      maxLines: 3,
      minLines: 2,
      style: TextStyle(fontSize: 12.5, color: AppColors.text),
      decoration: InputDecoration(
        hintText: '说说这段画面，发布后会展示在视频卡片上',
        hintStyle: TextStyle(fontSize: 11.5, color: AppColors.textFaint),
        counterStyle: TextStyle(fontSize: 10, color: AppColors.textFaint),
        filled: true,
        fillColor: AppColors.surface,
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: BorderSide.none,
        ),
      ),
    );
  }

  Widget _declaration() {
    return InkWell(
      onTap: _submitting ? null : () => setState(() => _aiDeclared = !_aiDeclared),
      borderRadius: BorderRadius.circular(8),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 2),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              width: 24,
              height: 24,
              child: Checkbox(
                value: _aiDeclared,
                onChanged: _submitting
                    ? null
                    : (v) => setState(() => _aiDeclared = v ?? false),
                activeColor: AppColors.cyan,
                side: BorderSide(color: AppColors.textMuted),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                '我确认该视频由 AI 生成，未使用他人实拍素材，并同意按平台规范加注「AI 生成」标识。',
                style: TextStyle(
                    fontSize: 10.5, color: AppColors.textMuted, height: 1.5),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
