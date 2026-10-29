"""Deterministic launcher-layer layout for the existing circular OpenElf mark.

The supplied square remains the in-app asset. Launcher layers use only its
central circular artwork, without the photographed/premasked square corners.
"""
from PIL import Image, ImageDraw


def circular_mark(source, size):
    assert source.width == source.height
    # P1's gradient circle occupies the central 80% of the supplied square.
    inset = round(source.width * .10)
    mark = source.crop((inset, inset, source.width - inset, source.height - inset)).convert('RGBA')
    alpha = Image.new('L', mark.size)
    ImageDraw.Draw(alpha).ellipse((0, 0, mark.width - 1, mark.height - 1), fill=255)
    mark.putalpha(alpha)
    return mark.resize((size, size), Image.Resampling.LANCZOS)


def launcher_square(source, size):
    canvas = Image.new('RGBA', (size, size), 'white')
    mark_size = round(size * .86)
    offset = (size - mark_size) // 2
    canvas.alpha_composite(circular_mark(source, mark_size), (offset, offset))
    return canvas.convert('RGB')


def adaptive_layer(source, size):
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    # Only the circular mark occupies the safe area, not a second square badge.
    mark_size = round(size * 64 / 108)
    offset = (size - mark_size) // 2
    canvas.alpha_composite(circular_mark(source, mark_size), (offset, offset))
    return canvas
