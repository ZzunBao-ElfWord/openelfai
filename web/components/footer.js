import { Icon } from './icons';
import { TOOLS } from '../lib/tools';

export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <span className="footer-brand">
          <Icon name="star4" size={13} />
          开放精灵 Openelf · 全球 AI 工具图鉴
        </span>
        <span className="footer-note">
          共收录 {TOOLS.length} 款工具 · 信息与链接以各工具官方渠道为准
        </span>
      </div>
    </footer>
  );
}
