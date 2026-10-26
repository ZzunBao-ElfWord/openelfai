import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../compliance/identity_verification.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/common.dart';

/// 实名认证：上传身份证 + 姓名/证件号核验。
///
/// 这是「本人形象」创建线的唯一图片入口——产品不开放任意照片上传，
/// 身份证照片仅用于核验本人身份，并作为本人形象生成的授权来源。
class IdentityVerifyPage extends StatefulWidget {
  const IdentityVerifyPage({super.key});

  @override
  State<IdentityVerifyPage> createState() => _IdentityVerifyPageState();
}

class _IdentityVerifyPageState extends State<IdentityVerifyPage> {
  final _picker = ImagePicker();
  final _nameCtrl = TextEditingController();
  final _idCtrl = TextEditingController();

  String? _frontPath;
  String? _backPath;
  Uint8List? _frontBytes;
  Uint8List? _backBytes;
  bool _authorized = false;
  bool _submitting = false;

  @override
  void dispose() {
    _nameCtrl.dispose();
    _idCtrl.dispose();
    super.dispose();
  }

  void _toast(String text) {
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(text)));
  }

  Future<void> _pick(bool front) async {
    try {
      // 仅从相册选择身份证照片；不提供「任意照片上传」入口。
      final file = await _picker.pickImage(
        source: ImageSource.gallery,
        maxWidth: 1600,
        imageQuality: 88,
      );
      if (file == null || !mounted) return;
      // 读字节做预览，Web（blob 路径）与原生（文件路径）均可显示。
      final bytes = await file.readAsBytes();
      if (!mounted) return;
      setState(() {
        if (front) {
          _frontPath = file.path;
          _frontBytes = bytes;
        } else {
          _backPath = file.path;
          _backBytes = bytes;
        }
      });
    } catch (_) {
      if (!mounted) return;
      _toast('无法打开相册，请检查权限后重试');
    }
  }

  Future<void> _submit() async {
    if (_submitting) return;
    if (_frontPath == null) {
      _toast('请上传身份证人像面');
      return;
    }
    if (_backPath == null) {
      _toast('请上传身份证国徽面');
      return;
    }
    if (!_authorized) {
      _toast('请先勾选授权声明');
      return;
    }
    setState(() => _submitting = true);
    final error = await AppState.instance.submitIdentityVerification(
      realName: _nameCtrl.text,
      idNumber: _idCtrl.text,
      frontImagePath: _frontPath!,
      backImagePath: _backPath!,
    );
    if (!mounted) return;
    setState(() => _submitting = false);
    if (error != null) {
      _toast(error);
      return;
    }
    final identity = AppState.instance.identity;
    await showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (dctx) => AlertDialog(
        backgroundColor: AppColors.surface,
        title: Text('实名认证完成', style: TextStyle(color: AppColors.text)),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.verified_user, size: 18, color: AppColors.ok),
                const SizedBox(width: 8),
                Text('${identity?.maskedName ?? ''} · 已核验',
                    style: TextStyle(fontSize: 13, color: AppColors.text)),
              ],
            ),
            const SizedBox(height: 8),
            Text('证件号 ${identity?.maskedIdNumber ?? ''}',
                style: TextStyle(fontSize: 11, color: AppColors.textMuted)),
            const SizedBox(height: 4),
            Text('完整证件信息未在本地留存。',
                style: TextStyle(fontSize: 11, color: AppColors.textMuted)),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dctx).pop(),
            child: Text('完成', style: TextStyle(color: AppColors.cyan)),
          ),
        ],
      ),
    );
    if (!mounted) return;
    Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: AppBackground(
        child: SafeArea(
          bottom: false,
          child: AnimatedBuilder(
            animation: AppState.instance,
            builder: (context, _) {
              final identity = AppState.instance.identity;
              final verified = identity?.verified ?? false;
              return Column(
                children: [
                  _header(context, verified),
                  Expanded(
                    child: SingleChildScrollView(
                      padding: const EdgeInsets.fromLTRB(20, 4, 20, 20),
                      child: verified
                          ? _verifiedCard(identity!)
                          : _form(identity),
                    ),
                  ),
                  if (!verified) _footer(identity),
                ],
              );
            },
          ),
        ),
      ),
    );
  }

  Widget _header(BuildContext context, bool verified) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(8, 6, 14, 6),
      child: Row(
        children: [
          IconButton(
            onPressed: () => Navigator.of(context).maybePop(),
            icon: Icon(Icons.arrow_back_ios_new,
                size: 18, color: AppColors.textSub),
            tooltip: '返回',
          ),
          const Spacer(),
          Text('实名认证',
              style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                  color: AppColors.text)),
          const Spacer(),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
            decoration: BoxDecoration(
              color: verified
                  ? AppColors.ok.withOpacity(0.12)
                  : AppColors.surfaceAlt,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(
                  color: verified
                      ? AppColors.ok.withOpacity(0.4)
                      : AppColors.stroke),
            ),
            child: Text(verified ? '已认证' : '未认证',
                style: TextStyle(
                    fontSize: 10,
                    color: verified ? AppColors.ok : AppColors.textSub)),
          ),
        ],
      ),
    );
  }

  // —— 已认证态 ——

  Widget _verifiedCard(IdentityVerification identity) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(18),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(18),
            gradient: AppColors.brandGradientSoft,
            border: Border.all(color: AppColors.stroke),
          ),
          child: Column(
            children: [
              Container(
                width: 54,
                height: 54,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  gradient: AppColors.brandGradient,
                ),
                alignment: Alignment.center,
                child: Icon(Icons.verified_user,
                    size: 25, color: AppColors.onBrand),
              ),
              const SizedBox(height: 12),
              Text(identity.maskedName,
                  style: TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.w700,
                      color: AppColors.text)),
              const SizedBox(height: 4),
              Text(identity.maskedIdNumber,
                  style: TextStyle(
                      fontSize: 11.5,
                      color: AppColors.textMuted,
                      fontFamily: 'monospace')),
              const SizedBox(height: 10),
              Text(
                  '核验时间 ${_formatTime(identity.verifiedAt)} · ${identity.provider}',
                  style:
                      TextStyle(fontSize: 10.5, color: AppColors.textMuted)),
            ],
          ),
        ),
        const SizedBox(height: 16),
        _noteRow(Icons.badge_outlined, '身份证人像面仅用于生成「本人形象」AI，不公开、不进入信息流。'),
        _noteRow(Icons.lock_outline, '本地只保留脱敏姓名与证件号，完整号码未留存。'),
        _noteRow(Icons.sync_alt, '授权记录随 AI 转赠转移，接收方需重新完成本人授权。'),
      ],
    );
  }

  // —— 认证表单 ——

  Widget _form(IdentityVerification? identity) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: AppColors.stroke),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(Icons.shield_outlined, size: 18, color: AppColors.cyan),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  '上传身份证完成实名核验后，才能使用「身份证授权」这条线创建以你本人为原型的 AI。我们不提供任意照片上传。',
                  style: TextStyle(
                      fontSize: 11,
                      height: 1.6,
                      color: AppColors.textSub),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 18),
        Text('身份证照片',
            style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: AppColors.text)),
        const SizedBox(height: 4),
        Text('仅支持从相册选择证件照片，照片不会公开展示。',
            style: TextStyle(fontSize: 10.5, color: AppColors.textMuted)),
        const SizedBox(height: 10),
        Row(
          children: [
            Expanded(
              child: _photoSlot(
                label: '人像面',
                bytes: _frontBytes,
                onTap: () => _pick(true),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: _photoSlot(
                label: '国徽面',
                bytes: _backBytes,
                onTap: () => _pick(false),
              ),
            ),
          ],
        ),
        const SizedBox(height: 20),
        _field(
          label: '姓名',
          hint: '与身份证上的姓名一致',
          controller: _nameCtrl,
          maxLength: 20,
        ),
        _field(
          label: '身份证号',
          hint: '18 位，最后一位可为 X',
          controller: _idCtrl,
          maxLength: 18,
          upperCase: true,
        ),
        const SizedBox(height: 4),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Checkbox(
              value: _authorized,
              onChanged: (v) => setState(() => _authorized = v ?? false),
              activeColor: AppColors.cyan,
              checkColor: AppColors.onBrand,
              materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
              visualDensity: VisualDensity.compact,
            ),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.only(top: 8, right: 4),
                child: Text(
                  '我授权 OpenElf 采集并核验我的身份证信息，并在创建「本人形象」AI 时使用身份证人像面作为形象生成来源。',
                  style: TextStyle(
                      fontSize: 10.5, height: 1.55, color: AppColors.textSub),
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
        Text(
          '核验服务接入前为本地校验：格式、校验位与出生日期。正式上线后将接入公安实名核验服务。',
          style: TextStyle(fontSize: 10, height: 1.5, color: AppColors.textMuted),
        ),
      ],
    );
  }

  Widget _photoSlot({
    required String label,
    required Uint8List? bytes,
    required VoidCallback onTap,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(14),
      child: Container(
        height: 104,
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(
              color: bytes == null ? AppColors.stroke : AppColors.cyan),
        ),
        clipBehavior: Clip.antiAlias,
        child: bytes == null
            ? Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.add_a_photo_outlined,
                      size: 22, color: AppColors.textMuted),
                  const SizedBox(height: 6),
                  Text(label,
                      style: TextStyle(
                          fontSize: 11.5, color: AppColors.textSub)),
                  const SizedBox(height: 2),
                  Text('点击上传',
                      style: TextStyle(
                          fontSize: 10, color: AppColors.textMuted)),
                ],
              )
            : Stack(
                fit: StackFit.expand,
                children: [
                  Image.memory(bytes, fit: BoxFit.cover),
                  Positioned(
                    left: 8,
                    bottom: 8,
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 7, vertical: 3),
                      decoration: BoxDecoration(
                        color: Colors.black.withOpacity(0.55),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Text('$label · 已上传',
                          style: const TextStyle(
                              fontSize: 9.5, color: Colors.white)),
                    ),
                  ),
                ],
              ),
      ),
    );
  }

  Widget _field({
    required String label,
    required String hint,
    required TextEditingController controller,
    int? maxLength,
    bool upperCase = false,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label,
              style: TextStyle(fontSize: 11, color: AppColors.textMuted)),
          const SizedBox(height: 6),
          TextField(
            controller: controller,
            maxLength: maxLength,
            maxLines: 1,
            textCapitalization: upperCase
                ? TextCapitalization.characters
                : TextCapitalization.none,
            style: TextStyle(fontSize: 13, color: AppColors.text),
            decoration: InputDecoration(
              counterText: '',
              hintText: hint,
              hintStyle: TextStyle(fontSize: 12.5, color: AppColors.textFaint),
              filled: true,
              fillColor: AppColors.surface,
              contentPadding:
                  const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: BorderSide(color: AppColors.stroke),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: BorderSide(color: AppColors.stroke),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _footer(IdentityVerification? identity) {
    final enabled = !_submitting;
    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 6, 20, 12),
        child: SizedBox(
          width: double.infinity,
          height: 48,
          child: FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor:
                  enabled ? AppColors.cyan : AppColors.surfaceHigh,
              foregroundColor:
                  enabled ? AppColors.onBrand : AppColors.textFaint,
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(14)),
            ),
            onPressed: enabled ? _submit : null,
            child: Text(_submitting ? '核验中…' : '提交核验',
                style: const TextStyle(
                    fontSize: 14, fontWeight: FontWeight.w700)),
          ),
        ),
      ),
    );
  }

  Widget _noteRow(IconData icon, String text) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 14, color: AppColors.textMuted),
          const SizedBox(width: 8),
          Expanded(
            child: Text(text,
                style: TextStyle(
                    fontSize: 10.5, height: 1.55, color: AppColors.textSub)),
          ),
        ],
      ),
    );
  }

  static String _formatTime(DateTime time) {
    String two(int v) => v.toString().padLeft(2, '0');
    return '${time.year}-${two(time.month)}-${two(time.day)} '
        '${two(time.hour)}:${two(time.minute)}';
  }
}
