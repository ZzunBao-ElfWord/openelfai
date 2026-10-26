'use client';

import { Icon } from './icons';

/* 详情页返回：会话内有导航历史则 back（回到带筛选参数的列表页），
 * 无历史（外链直达）时降级为跳转默认列表视图（应用 → /tools/，大模型 → /models/）。 */
export default function BackButton({ fallback = '/tools/' }) {
  return (
    <button
      type="button"
      className="back"
      onClick={() => {
        if (window.history.length > 1) window.history.back();
        else window.location.assign(fallback);
      }}
    >
      <Icon name="arrowLeft" size={16} />
      <span>返回列表</span>
    </button>
  );
}
