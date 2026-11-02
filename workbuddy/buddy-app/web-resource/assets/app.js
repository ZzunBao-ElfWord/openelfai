// OpenElf 工作台交互逻辑
// 通过 WorkBuddy JSSDK 将用户选择的内容带入 AI 对话输入框

const PROMPTS = {
  character: '我想设计一个原创 AI 形象，请帮我拆解为风格、发型、服装、气质四部分，给出两个可执行的方案，并生成预览。',
  generator: '我要批量生成角色。请帮我设定图层权重，批量生成 50 个不同形象，输出联系表让我挑选。',
  video: '我要做爆款短视频剪辑。我会上传视频素材，请按气口规则切片，每条配爆款标题和文案。',
  influencer: '我要策划网红选题。请帮我按时效性、共鸣度、变现力、差异化四维打分，给出第一名的文案骨架。',
};

async function fillMessage(content) {
  if (typeof wb === 'undefined' || !wb.fillMessage) {
    // 非 WorkBuddy 环境（本地预览），复制到剪贴板
    try {
      await navigator.clipboard.writeText(content);
      showToast('已复制提示词到剪贴板');
    } catch (_) {
      showToast('提示词：' + content.slice(0, 50) + '...');
    }
    return;
  }

  try {
    await wb.fillMessage({ content });
  } catch (err) {
    showToast('唤起对话失败：' + (err.message || err));
  }
}

function showToast(message) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    bottom: 32px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(26, 26, 46, 0.92);
    color: #fff;
    padding: 10px 20px;
    border-radius: 24px;
    font-size: 13px;
    z-index: 9999;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
    animation: toastIn 0.2s ease;
  `;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 2000);
}

// 绑定能力卡片
document.querySelectorAll('.card').forEach((card) => {
  card.addEventListener('click', () => {
    const action = card.dataset.action;
    const prompt = PROMPTS[action];
    if (prompt) fillMessage(prompt);
  });
});

// 绑定快捷入口
document.querySelectorAll('.quick-item').forEach((item) => {
  item.addEventListener('click', () => {
    const prompt = item.dataset.prompt;
    if (prompt) fillMessage(prompt);
  });
});

// 日夜间适配
async function applyTheme() {
  if (typeof wb === 'undefined' || !wb.config) return;
  try {
    const theme = await wb.config.get('theme');
    if (theme === 'dark') {
      document.documentElement.style.colorScheme = 'dark';
    } else if (theme === 'light') {
      document.documentElement.style.colorScheme = 'light';
    }
  } catch (_) {
    // ignore
  }
}

applyTheme();

if (typeof wb !== 'undefined' && wb.on) {
  wb.on('config.preferences.theme.changed', (payload) => {
    if (payload.theme === 'dark') {
      document.documentElement.style.colorScheme = 'dark';
    } else if (payload.theme === 'light') {
      document.documentElement.style.colorScheme = 'light';
    }
  });
}
