/* 法务与安全类文档页的共享外壳：返回入口、标题区、更新日期与正文卡片。 */
import Link from 'next/link';
import { Icon } from './icons';
import styles from './legal-doc.module.css';

export default function LegalDoc({ eyebrow, title, lead, updated, children }) {
  return (
    <div className={styles.page}>
      <div className={styles.wrap}>
        <Link className={styles.back} href="/">
          <Icon name="arrowLeft" size={14} />
          返回首页
        </Link>

        <header className={styles.head}>
          <p className={styles.eyebrow}>{eyebrow}</p>
          <h1 className={styles.title}>{title}</h1>
          {lead ? <p className={styles.lead}>{lead}</p> : null}
          <p className={styles.meta}>最后更新 · {updated}</p>
        </header>

        <div className={styles.body}>{children}</div>
      </div>
    </div>
  );
}
