import unittest
from pathlib import Path
from PIL import Image
from launcher_artwork import adaptive_layer, launcher_square

APP = Path(__file__).resolve().parents[1]


class LauncherArtworkTests(unittest.TestCase):
    def setUp(self):
        self.source = Image.open(APP / 'scripts/app_icon_source.jpg').convert('RGB')

    def test_legacy_has_white_unmasked_corners(self):
        icon = launcher_square(self.source, 192)
        for point in [(0, 0), (191, 0), (0, 191), (191, 191), (10, 10)]:
            self.assertEqual(icon.getpixel(point), (255, 255, 255))

    def test_adaptive_has_no_second_square_badge(self):
        icon = adaptive_layer(self.source, 432)
        self.assertEqual(icon.getchannel('A').getbbox(), (88, 88, 344, 344))
        self.assertEqual(icon.getpixel((88, 88))[3], 0)
        self.assertEqual(icon.getpixel((216, 216))[3], 255)

    def test_entire_mark_fits_android_safe_area(self):
        icon = adaptive_layer(self.source, 432)
        x0, y0, x1, y1 = icon.getchannel('A').getbbox()
        self.assertGreaterEqual(x0, 84)
        self.assertGreaterEqual(y0, 84)
        self.assertLessEqual(x1, 348)
        self.assertLessEqual(y1, 348)

    def test_all_displayed_brand_and_splash_images_have_clean_corners(self):
        paths = [APP / 'assets/brand/app_icon.png',
                 APP / 'android/app/src/main/res/drawable-nodpi/launch_icon.png']
        paths += list((APP / 'ios/Runner/Assets.xcassets/LaunchImage.imageset').glob('*.png'))
        paths += list((APP / 'ios/Runner/Assets.xcassets/AppIcon.appiconset').glob('*.png'))
        paths += [APP / 'web/favicon.png'] + list((APP / 'web/icons').glob('*.png'))
        for path in paths:
            with self.subTest(path=path.name):
                image = Image.open(path).convert('RGB')
                for point in [(0, 0), (image.width - 1, 0),
                              (0, image.height - 1), (image.width - 1, image.height - 1)]:
                    self.assertEqual(image.getpixel(point), (255, 255, 255))

    def test_original_reference_is_not_destroyed(self):
        self.assertLess(max(self.source.getpixel((5, 5))), 40)


if __name__ == '__main__':
    unittest.main()
