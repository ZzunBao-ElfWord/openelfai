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
