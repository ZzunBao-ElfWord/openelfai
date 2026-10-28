"""Resize the supplied OpenElf artwork for all app icon surfaces.

No artwork is redrawn or cropped. --check needs only the standard library.
Generation uses Pillow and the existing iOS icon generator.
"""
import argparse
import hashlib
import json
import struct
from pathlib import Path

import generate_ios_icons as ios

APP = Path(__file__).resolve().parents[1]
ORIGINAL = APP / 'scripts/app_icon_source.jpg'
SOURCE = APP / 'assets/brand/app_icon.png'
MANIFEST = APP / 'scripts/app_icons_manifest.json'


def targets():
    result = {'assets/brand/app_icon.png': (1024, 'RGB', 'plain')}
    for density, size, foreground in [('mdpi', 48, 108), ('hdpi', 72, 162),
                                      ('xhdpi', 96, 216), ('xxhdpi', 144, 324),
                                      ('xxxhdpi', 192, 432)]:
        prefix = f'android/app/src/main/res/mipmap-{density}/'
        result[prefix + 'ic_launcher.png'] = (size, 'RGB', 'plain')
        result[prefix + 'ic_launcher_foreground.png'] = (foreground, 'RGBA', 'adaptive')
    result['android/app/src/main/res/drawable-nodpi/launch_icon.png'] = (288, 'RGB', 'plain')
    for suffix, size in [('', 168), ('@2x', 336), ('@3x', 504)]:
        result[f'ios/Runner/Assets.xcassets/LaunchImage.imageset/LaunchImage{suffix}.png'] = (size, 'RGB', 'plain')
    result['web/favicon.png'] = (32, 'RGB', 'plain')
    for size in [192, 512]:
        result[f'web/icons/Icon-{size}.png'] = (size, 'RGB', 'plain')
        result[f'web/icons/Icon-maskable-{size}.png'] = (size, 'RGB', 'maskable')
    return result


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def check():
    manifest = json.loads(MANIFEST.read_text(encoding='utf-8'))
    assert manifest['original_sha256'] == digest(ORIGINAL), 'Original artwork changed'
    expected = targets()
    assert set(manifest['icons']) == set(expected), 'Icon target catalog changed'
    for name, (size, mode, _) in expected.items():
        path = APP / name
        png = path.read_bytes()
        assert png[:8] == b'\x89PNG\r\n\x1a\n', name
        assert struct.unpack('>II', png[16:24]) == (size, size), name
        assert png[25] == (6 if mode == 'RGBA' else 2), name
        assert manifest['icons'][name] == digest(path), name
    ios_manifest = json.loads(ios.MANIFEST.read_text(encoding='utf-8'))
    assert ios_manifest['source_sha256'] == digest(SOURCE)
    assert set(ios_manifest['icons']) == set(ios.sizes())
    for name, dimensions in ios.sizes().items():
        path = ios.ICONS / name
        png = path.read_bytes()
        assert struct.unpack('>II', png[16:24]) == dimensions and png[25] == 2, name
        assert b'tRNS' not in png and ios_manifest['icons'][name] == digest(path), name
    print(f'Validated {len(expected)} shared/Android/web/launch images and {len(ios.sizes())} opaque iOS app icons')


def generate():
    from PIL import Image, ImageOps
    original = ImageOps.exif_transpose(Image.open(ORIGINAL)).convert('RGB')
    assert original.width == original.height, 'Use square artwork; never stretch or crop silently'
    for name, (size, mode, style) in targets().items():
        if style == 'adaptive':
            # Android's 108dp layer has a 66dp safe area. Keep the ENTIRE
            # supplied square inside it so round launchers cannot clip the elf.
            icon = Image.new('RGBA', (size, size), (255, 255, 255, 0))
            art_size = round(size * 66 / 108)
            art = original.resize((art_size, art_size), Image.Resampling.LANCZOS).convert('RGBA')
            inset = (size - art_size) // 2
            icon.alpha_composite(art, (inset, inset))
        elif style == 'maskable':
            icon = Image.new('RGB', (size, size), 'white')
            art_size = round(size * .8)
            inset = (size - art_size) // 2
            icon.paste(original.resize((art_size, art_size), Image.Resampling.LANCZOS), (inset, inset))
        else:
            icon = original.resize((size, size), Image.Resampling.LANCZOS)
        icon.convert(mode).save(APP / name)
    # Reuse the established iOS catalog and hash manifest format.
    opaque = Image.open(SOURCE).convert('RGB')
    for name, dimensions in ios.sizes().items():
        opaque.resize(dimensions, Image.Resampling.LANCZOS).save(ios.ICONS / name)
    ios.MANIFEST.write_text(json.dumps({'source_sha256': digest(SOURCE),
        'icons': {name: digest(ios.ICONS / name) for name in ios.sizes()}}, indent=2) + '\n', encoding='utf-8')
    MANIFEST.write_text(json.dumps({'original_sha256': digest(ORIGINAL),
        'icons': {name: digest(APP / name) for name in targets()}}, indent=2) + '\n', encoding='utf-8')
    check()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    check() if args.check else generate()
