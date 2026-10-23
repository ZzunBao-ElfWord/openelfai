"""Generate opaque iOS launcher icons from the existing OpenElf brand asset.

Requires Pillow for generation. --check uses only the Python standard library
and validates the committed asset hashes, dimensions and non-alpha PNG format.
"""

import argparse
import hashlib
import json
import struct
from pathlib import Path


APP = Path(__file__).resolve().parents[1]
SOURCE = APP / 'assets/brand/app_icon.png'
ICONS = APP / 'ios/Runner/Assets.xcassets/AppIcon.appiconset'
MANIFEST = APP / 'scripts/ios_icons_manifest.json'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def sizes():
    result = {}
    for entry in json.loads((ICONS / 'Contents.json').read_text())['images']:
        width, height = map(float, entry['size'].split('x'))
        scale = float(entry['scale'].removesuffix('x'))
        result[entry['filename']] = (round(width * scale), round(height * scale))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    expected_sizes = sizes()
    if args.check:
        manifest = json.loads(MANIFEST.read_text())
        assert manifest['source_sha256'] == digest(SOURCE), 'Brand image changed: regenerate icons'
        assert set(manifest['icons']) == set(expected_sizes), 'Icon catalog changed: regenerate icons'
        for name, dimensions in expected_sizes.items():
            path = ICONS / name
            assert digest(path) == manifest['icons'][name], f'Icon changed: {name}'
            png = path.read_bytes()
            assert png[:8] == b'\x89PNG\r\n\x1a\n', name
            assert struct.unpack('>II', png[16:24]) == dimensions, name
            assert png[25] == 2 and b'tRNS' not in png, f'Expected opaque RGB icon: {name}'
        print(f'Validated {len(expected_sizes)} branded, opaque iOS icons')
        return

    from PIL import Image

    source = Image.open(SOURCE).convert('RGBA')
    assert source.width == source.height, 'Brand icon must be square'
    # App Store icons must be opaque; retain the existing artwork on its navy background.
    opaque = Image.new('RGBA', source.size, '#0d1124')
    opaque.alpha_composite(source)
    opaque = opaque.convert('RGB')
    for name, dimensions in expected_sizes.items():
        opaque.resize(dimensions, Image.Resampling.LANCZOS).save(ICONS / name)
    manifest = {'source_sha256': digest(SOURCE),
                'icons': {name: digest(ICONS / name) for name in expected_sizes}}
    MANIFEST.write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'Generated {len(expected_sizes)} OpenElf iOS icons')


if __name__ == '__main__':
    main()
