// 鲸凌 / 鲸鱼娘 素材包生成脚本
// 角色类图片生成接口会返回占位图，这里用本地 SVG + sharp 栅格化。
// 运行：node docs/assets/gen-whale-ling.mjs
// 输出：C:\官网html\openelf\whale-ling-asset-pack（与 openelfai 同级，便于打包上传）

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire('C:/官网html/openelf/openelfai/web/package.json');
const sharp = require('sharp');

const OUT = 'C:/官网html/openelf/whale-ling-asset-pack';
const VISUAL = path.join(OUT, 'visual');
const SOURCE = path.join(OUT, 'visual', 'source');
fs.mkdirSync(VISUAL, { recursive: true });
fs.mkdirSync(SOURCE, { recursive: true });

const C = {
  hairDeep: '#1F2C58',
  hairMid: '#363C88',
  hairLight: '#6A5CE0',
  hairTip: '#9C8CFF',
  skin: '#FFE6D8',
  skinShade: '#F2BFA9',
  navy: '#243A78',
  aqua: '#7FD8FF',
  coral: '#FF9FB2',
  ink: '#1B2340',
};

const DEFS = `
<defs>
  <linearGradient id="hair" x1="0.15" y1="0" x2="0.85" y2="1">
    <stop offset="0%" stop-color="${C.hairDeep}"/>
    <stop offset="45%" stop-color="${C.hairMid}"/>
    <stop offset="78%" stop-color="${C.hairLight}"/>
    <stop offset="100%" stop-color="${C.hairTip}"/>
  </linearGradient>
  <linearGradient id="hairStreak" x1="0" y1="0" x2="0.6" y2="1">
    <stop offset="0%" stop-color="#C7B9FF" stop-opacity=".85"/>
    <stop offset="100%" stop-color="#6F5BE8" stop-opacity="0"/>
  </linearGradient>
  <linearGradient id="skinG" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#FFEEE5"/>
    <stop offset="65%" stop-color="${C.skin}"/>
    <stop offset="100%" stop-color="${C.skinShade}"/>
  </linearGradient>
  <linearGradient id="iris" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#B4F4FF"/>
    <stop offset="50%" stop-color="#4FC3F7"/>
    <stop offset="100%" stop-color="#1E5FB8"/>
  </linearGradient>
  <linearGradient id="dressG" x1="0" y1="0" x2="0.3" y2="1">
    <stop offset="0%" stop-color="#FFFFFF"/>
    <stop offset="100%" stop-color="#D6E7FF"/>
  </linearGradient>
  <linearGradient id="finG" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="#A8EDFF"/>
    <stop offset="100%" stop-color="#4A7BE0"/>
  </linearGradient>
  <radialGradient id="glowG">
    <stop offset="0%" stop-color="${C.aqua}" stop-opacity=".75"/>
    <stop offset="100%" stop-color="${C.aqua}" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="oceanG" cx="50%" cy="38%" r="78%">
    <stop offset="0%" stop-color="#2A4C8F"/>
    <stop offset="55%" stop-color="#132A57"/>
    <stop offset="100%" stop-color="#070F24"/>
  </radialGradient>
</defs>`;

// —— 表情零件 ——

function eye(side, expression) {
  const cx = side === 'left' ? 452 : 572;
  const dir = side === 'left' ? -1 : 1;
  if (expression === 'sleepy' || expression === 'happy') {
    const lift = expression === 'happy' ? -18 : 0;
    return `
      <path d="M${cx - 46} ${462 + lift} Q${cx} ${498 + lift} ${cx + 46} ${462 + lift}"
        stroke="${C.ink}" stroke-width="11" fill="none" stroke-linecap="round"/>`;
  }
  if (expression === 'shy') {
    return `
      <ellipse cx="${cx}" cy="462" rx="42" ry="46" fill="#fff"/>
      <ellipse cx="${cx}" cy="468" rx="34" ry="40" fill="url(#iris)"/>
      <ellipse cx="${cx}" cy="478" rx="15" ry="19" fill="#0E1B3A" opacity=".85"/>
      <circle cx="${cx + dir * 12}" cy="438" r="10" fill="#fff"/>
      <path d="M${cx - 40} 430 Q${cx} 408 ${cx + 40} 430" stroke="${C.ink}" stroke-width="9" fill="none" stroke-linecap="round"/>`;
  }
  if (expression === 'surprise') {
    return `
      <ellipse cx="${cx}" cy="458" rx="48" ry="56" fill="#fff"/>
      <ellipse cx="${cx}" cy="460" rx="40" ry="50" fill="url(#iris)"/>
      <ellipse cx="${cx}" cy="468" rx="18" ry="23" fill="#0E1B3A" opacity=".9"/>
      <circle cx="${cx + dir * 14}" cy="432" r="12" fill="#fff"/>
      <circle cx="${cx - dir * 10}" cy="488" r="6" fill="#fff" opacity=".9"/>
      <path d="M${cx - 46} 420 Q${cx} 394 ${cx + 46} 420" stroke="${C.ink}" stroke-width="10" fill="none" stroke-linecap="round"/>`;
  }
  if (expression === 'sad') {
    return `
      <ellipse cx="${cx}" cy="464" rx="44" ry="50" fill="#fff"/>
      <ellipse cx="${cx}" cy="472" rx="36" ry="43" fill="url(#iris)"/>
      <ellipse cx="${cx}" cy="482" rx="16" ry="20" fill="#0E1B3A" opacity=".85"/>
      <circle cx="${cx + dir * 12}" cy="444" r="10" fill="#fff"/>
      <path d="M${cx - 46} 426 Q${cx} 416 ${cx + 46} 426" stroke="${C.ink}" stroke-width="10" fill="none" stroke-linecap="round"/>
      <path d="M${cx + dir * 30} 500 Q${cx + dir * 36} 540 ${cx + dir * 22} 548 Q${cx + dir * 12} 534 ${cx + dir * 18} 504 Z"
        fill="${C.aqua}" opacity=".8"/>`;
    }
  // smile / smug / cheer / default
  const sparkle = expression === 'cheer'
    ? `<path d="M${cx + dir * 40} 412 l6 16 16 6 -16 6 -6 16 -6 -16 -16 -6 16 -6 z" fill="#B4F4FF"/>`
    : '';
  return `
    <ellipse cx="${cx}" cy="460" rx="46" ry="56" fill="#fff"/>
    <ellipse cx="${cx}" cy="466" rx="38" ry="48" fill="url(#iris)"/>
    <ellipse cx="${cx}" cy="478" rx="17" ry="21" fill="#0E1B3A" opacity=".85"/>
    <circle cx="${cx + dir * 13}" cy="434" r="12" fill="#fff"/>
    <circle cx="${cx - dir * 10}" cy="494" r="7" fill="#fff" opacity=".85"/>
    <path d="M${cx - 46} 426 Q${cx} 396 ${cx + 46} 426" stroke="${C.ink}" stroke-width="10" fill="none" stroke-linecap="round"/>
    ${sparkle}`;
}

function mouth(expression) {
  switch (expression) {
    case 'happy':
    case 'cheer':
      return `
        <path d="M480 546 Q512 596 544 546 Z" fill="#C4566C"/>
        <path d="M492 552 Q512 574 532 552 Z" fill="#FF9FB2"/>`;
    case 'shy':
      return `<path d="M492 552 Q512 564 532 552" stroke="#C4566C" stroke-width="7" fill="none" stroke-linecap="round"/>`;
    case 'sleepy':
      return `<path d="M496 552 Q512 544 528 552" stroke="#C4566C" stroke-width="7" fill="none" stroke-linecap="round"/>`;
    case 'surprise':
      return `<ellipse cx="512" cy="556" rx="18" ry="24" fill="#C4566C"/><ellipse cx="512" cy="562" rx="11" ry="13" fill="#FF9FB2"/>`;
    case 'sad':
      return `<path d="M488 564 Q512 548 536 564" stroke="#C4566C" stroke-width="8" fill="none" stroke-linecap="round"/>`;
    case 'smug':
      return `<path d="M486 552 Q512 566 536 546" stroke="#C4566C" stroke-width="8" fill="none" stroke-linecap="round"/>`;
    default:
      return `<path d="M488 548 Q512 570 536 548" stroke="#C4566C" stroke-width="8" fill="none" stroke-linecap="round"/>`;
  }
}

function bust(expression = 'smile') {
  const shyBlush = expression === 'shy' ? 0.62 : 0.34;
  return `
  <!-- 后发 -->
  <path d="M512 146 C704 146 802 292 802 478 C802 650 858 814 898 992 L674 992
    C654 824 648 700 640 594 L384 594 C376 700 370 824 350 992 L126 992
    C166 814 222 650 222 478 C222 292 320 146 512 146 Z" fill="url(#hair)"/>
  <path d="M286 486 C286 690 272 846 236 964" stroke="#0E1734" stroke-opacity=".3" stroke-width="26" fill="none"/>
  <path d="M738 486 C738 690 752 846 788 964" stroke="#0E1734" stroke-opacity=".3" stroke-width="26" fill="none"/>
  <path d="M318 320 C302 470 300 640 316 790" stroke="url(#hairStreak)" stroke-width="16" fill="none" opacity=".55"/>
  <path d="M706 320 C722 470 724 640 708 790" stroke="url(#hairStreak)" stroke-width="16" fill="none" opacity=".55"/>

  <!-- 肩与衣 -->
  <path d="M512 624 C424 624 352 670 326 740 L294 1024 L730 1024 L698 740
    C672 670 600 624 512 624 Z" fill="url(#dressG)"/>
  <path d="M398 700 C372 818 362 918 358 1024 L294 1024 L326 740
    C340 702 366 674 398 700 Z" fill="#E7F1FF"/>
  <path d="M626 700 C652 818 662 918 666 1024 L730 1024 L698 740
    C684 702 658 674 626 700 Z" fill="#E7F1FF"/>
  <path d="M400 660 Q512 724 624 660 L624 700 Q512 766 400 700 Z" fill="${C.navy}"/>
  <path d="M408 668 L512 770 L512 690 Z" fill="#F8FBFF" opacity=".96"/>
  <path d="M616 668 L512 770 L512 690 Z" fill="#F8FBFF" opacity=".96"/>
  <path d="M474 730 L512 800 L550 730 L512 754 Z" fill="${C.aqua}" opacity=".9"/>

  <!-- 颈 -->
  <path d="M468 566 L556 566 L564 648 Q512 672 460 648 Z" fill="${C.skinShade}"/>
  <ellipse cx="512" cy="590" rx="47" ry="18" fill="#E6AC97" opacity=".55"/>

  <!-- 脸 -->
  <ellipse cx="512" cy="448" rx="152" ry="170" fill="url(#skinG)"/>

  <!-- 鳍状耳 -->
  <path d="M356 408 C304 368 252 350 214 372 C248 404 262 436 250 480
    C302 480 340 462 360 450 Z" fill="url(#finG)" opacity=".95"/>
  <path d="M668 408 C720 368 772 350 810 372 C776 404 762 436 774 480
    C722 480 684 462 664 450 Z" fill="url(#finG)" opacity=".95"/>
  <path d="M340 414 C306 392 276 380 252 384 C278 404 290 428 286 452
    C312 452 332 442 346 432 Z" fill="#D6F6FF" opacity=".7"/>
  <path d="M684 414 C718 392 748 380 772 384 C746 404 734 428 738 452
    C712 452 692 442 678 432 Z" fill="#D6F6FF" opacity=".7"/>

  <!-- 刘海 -->
  <path d="M512 160 C632 160 716 238 728 360
    C702 332 668 314 638 310
    C622 352 592 374 558 380
    C550 338 534 308 512 290
    C490 308 474 338 466 380
    C432 374 402 352 386 310
    C356 314 322 332 296 360
    C308 238 392 160 512 160 Z" fill="url(#hair)"/>
  <path d="M512 176 C596 176 668 226 700 312 C666 284 632 270 606 270
    C582 300 550 314 512 318 C474 314 442 300 418 270
    C392 270 358 284 324 312 C356 226 428 176 512 176 Z" fill="url(#hairStreak)" opacity=".35"/>
  <path d="M296 360 C266 432 260 520 276 604 C300 626 332 606 336 564
    C344 474 342 404 354 358 Z" fill="url(#hair)"/>
  <path d="M728 360 C758 432 764 520 748 604 C724 626 692 606 688 564
    C680 474 682 404 670 358 Z" fill="url(#hair)"/>

  <!-- 额星 -->
  <ellipse cx="512" cy="322" rx="54" ry="46" fill="url(#glowG)"/>
  <path d="M512 292 C522 314 532 324 554 334 C532 344 522 354 512 376
    C502 354 492 344 470 334 C492 324 502 314 512 292 Z" fill="#DFF8FF"/>
  <path d="M512 306 C519 320 526 327 540 334 C526 341 519 348 512 362
    C505 348 498 341 484 334 C498 327 505 320 512 306 Z" fill="${C.aqua}"/>

  <!-- 鲸尾发饰 -->
  <path d="M672 344 C696 306 736 294 764 310 C744 326 736 348 739 370
    C716 366 690 358 672 344 Z" fill="url(#finG)"/>
  <circle cx="676" cy="340" r="9" fill="#DFF8FF"/>

  <!-- 眉 -->
  <path d="M406 414 Q452 400 494 410" stroke="#7A6A96" stroke-width="6"
    fill="none" stroke-linecap="round" opacity=".45"/>
  <path d="M618 414 Q572 400 530 410" stroke="#7A6A96" stroke-width="6"
    fill="none" stroke-linecap="round" opacity=".45"/>

  <!-- 眼 -->
  ${eye('left', expression)}
  ${eye('right', expression)}

  <!-- 腮红 -->
  <ellipse cx="392" cy="516" rx="36" ry="18" fill="${C.coral}" opacity="${shyBlush}"/>
  <ellipse cx="632" cy="516" rx="36" ry="18" fill="${C.coral}" opacity="${shyBlush}"/>

  <!-- 嘴 -->
  ${mouth(expression)}

  <!-- 气泡 -->
  <g stroke="#9FE9FF" fill="none" opacity=".55">
    <circle cx="272" cy="220" r="17" stroke-width="3"/>
    <circle cx="792" cy="182" r="12" stroke-width="3"/>
    <circle cx="244" cy="596" r="10" stroke-width="2.5"/>
    <circle cx="800" cy="636" r="15" stroke-width="3"/>
    <circle cx="712" cy="150" r="7" stroke-width="2"/>
  </g>`;
}

// —— 背景零件 ——

function oceanBackground(w, h) {
  return `<rect width="${w}" height="${h}" fill="url(#oceanG)"/>`;
}

function whaleSilhouette(x, y, scale, opacity = 0.35) {
  return `
  <g transform="translate(${x} ${y}) scale(${scale})" fill="#0A1A3A" opacity="${opacity}">
    <path d="M0 40 C50 -6 126 -14 184 22 C210 38 232 42 262 26
      C248 58 224 76 192 84 L62 84 C28 84 10 70 0 40 Z"/>
    <path d="M244 30 C266 16 292 12 310 22 C294 34 288 50 290 66
      C272 62 256 50 244 30 Z"/>
    <circle cx="46" cy="32" r="4.5" fill="#DDF6FF"/>
  </g>`;
}

function bubbles(list) {
  return `<g stroke="#9FE9FF" fill="none">${list
    .map(([x, y, r, o]) => `<circle cx="${x}" cy="${y}" r="${r}" stroke-width="${Math.max(
      2,
      r / 6,
    )}" opacity="${o}"/>`)
    .join('')}</g>`;
}

// —— 各尺寸图 ——

function avatarSVG() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 1024 1024">
    ${DEFS}
    <rect width="1024" height="1024" fill="url(#oceanG)"/>
    <ellipse cx="512" cy="470" rx="330" ry="360" fill="url(#glowG)" opacity=".85"/>
    <g transform="translate(512 560) scale(1.2) translate(-512 -512)">
      ${bust('smile')}
    </g>
    <rect width="1024" height="1024" fill="none" stroke="#7FD8FF" stroke-opacity=".25" stroke-width="6"/>
  </svg>`;
}

function emojiSVG(expression) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 1024 1024">
    ${DEFS}
    <circle cx="512" cy="512" r="486" fill="url(#oceanG)"/>
    <circle cx="512" cy="512" r="486" fill="none" stroke="#7FD8FF" stroke-opacity=".35" stroke-width="10"/>
    <ellipse cx="512" cy="470" rx="300" ry="330" fill="url(#glowG)" opacity=".8"/>
    <g transform="translate(512 600) scale(1.24) translate(-512 -512)">
      ${bust(expression)}
    </g>
  </svg>`;
}

function portraitSVG() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1536" viewBox="0 0 1024 1536">
    ${DEFS}
    <defs>
      <linearGradient id="pbg" x1="0" y1="0" x2="0.2" y2="1">
        <stop offset="0%" stop-color="#081228"/>
        <stop offset="52%" stop-color="#153266"/>
        <stop offset="100%" stop-color="#4A3E97"/>
      </linearGradient>
      <linearGradient id="ray" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#9FE9FF" stop-opacity=".28"/>
        <stop offset="100%" stop-color="#9FE9FF" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <rect width="1024" height="1536" fill="url(#pbg)"/>
    <g opacity=".55">
      <path d="M300 0 L420 0 L620 1536 L420 1536 Z" fill="url(#ray)"/>
      <path d="M560 0 L620 0 L820 1536 L700 1536 Z" fill="url(#ray)"/>
    </g>
    <circle cx="806" cy="242" r="112" fill="#DFF8FF" opacity=".9"/>
    <circle cx="806" cy="242" r="152" fill="url(#glowG)"/>
    ${whaleSilhouette(70, 690, 1.9, 0.3)}
    ${whaleSilhouette(560, 1020, 1.1, 0.18)}
    ${bubbles([
      [182, 300, 20, 0.5],
      [140, 470, 12, 0.4],
      [886, 520, 16, 0.45],
      [790, 700, 9, 0.35],
      [232, 834, 14, 0.3],
      [930, 900, 11, 0.3],
    ])}
    <g transform="translate(512 760) scale(1.3) translate(-512 -512)">
      ${bust('smile')}
    </g>
  </svg>`;
}

function coverRadioSVG() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
    ${DEFS}
    <defs>
      <linearGradient id="rbg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#060E20"/>
        <stop offset="55%" stop-color="#152A56"/>
        <stop offset="100%" stop-color="#4A3E97"/>
      </linearGradient>
    </defs>
    <rect width="1920" height="1080" fill="url(#rbg)"/>
    ${whaleSilhouette(1180, 780, 2.2, 0.22)}
    <g transform="translate(520 548)">
      <ellipse cx="0" cy="0" rx="330" ry="330" fill="url(#glowG)" opacity=".6"/>
      <g fill="none" stroke="#7FD8FF">
        <circle r="150" stroke-width="8" opacity=".75"/>
        <circle r="238" stroke-width="6" opacity=".45"/>
        <circle r="326" stroke-width="5" opacity=".28"/>
        <circle r="414" stroke-width="4" opacity=".16"/>
      </g>
      <g>
        <rect x="-62" y="-152" width="124" height="228" rx="62" fill="#DFF8FF" opacity=".95"/>
        <rect x="-40" y="-130" width="80" height="184" rx="40" fill="#2A4C8F"/>
        <path d="M-96 34 C-96 104 -58 146 0 146 C58 146 96 104 96 34"
          stroke="#DFF8FF" stroke-width="12" fill="none" stroke-linecap="round"/>
        <rect x="-8" y="146" width="16" height="70" fill="#DFF8FF"/>
        <rect x="-58" y="212" width="116" height="14" rx="7" fill="#DFF8FF"/>
      </g>
      <g fill="#B4F4FF">
        <circle cx="-250" cy="-190" r="6"/>
        <circle cx="262" cy="-150" r="5"/>
        <circle cx="-282" cy="118" r="4"/>
        <circle cx="286" cy="178" r="7"/>
      </g>
    </g>
    <g transform="translate(1420 660) scale(1.14) translate(-512 -512)">
      ${bust('happy')}
    </g>
    ${bubbles([
      [176, 220, 22, 0.4],
      [250, 844, 14, 0.3],
      [900, 180, 12, 0.3],
      [1010, 940, 18, 0.25],
    ])}
    <rect x="0" y="0" width="1920" height="1080" fill="none" stroke="#7FD8FF" stroke-opacity=".18" stroke-width="8"/>
  </svg>`;
}

function coverNightSVG() {
  const holes = [];
  for (let y = 40; y < 1920; y += 92) {
    holes.push(`<rect x="34" y="${y}" width="34" height="52" rx="8"/>`);
    holes.push(`<rect x="1012" y="${y}" width="34" height="52" rx="8"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">
    ${DEFS}
    <defs>
      <linearGradient id="nbg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#04070F"/>
        <stop offset="45%" stop-color="#0C1B3A"/>
        <stop offset="100%" stop-color="#1C2F63"/>
      </linearGradient>
    </defs>
    <rect width="1080" height="1920" fill="url(#nbg)"/>
    <circle cx="292" cy="342" r="126" fill="#EAF9FF" opacity=".92"/>
    <circle cx="292" cy="342" r="196" fill="url(#glowG)"/>
    <g fill="#DFF8FF">
      <circle cx="760" cy="228" r="4" opacity=".8"/>
      <circle cx="880" cy="392" r="3" opacity=".6"/>
      <circle cx="640" cy="128" r="2.5" opacity=".7"/>
      <circle cx="944" cy="640" r="3.5" opacity=".55"/>
      <circle cx="168" cy="700" r="3" opacity=".5"/>
      <circle cx="486" cy="288" r="2" opacity=".6"/>
    </g>
    <g fill="#0A1730" opacity=".5">
      ${holes.join('')}
    </g>
    ${whaleSilhouette(210, 1040, 1.7, 0.25)}
    ${bubbles([
      [860, 980, 16, 0.3],
      [180, 1240, 24, 0.3],
      [930, 1280, 10, 0.25],
      [250, 1560, 14, 0.2],
    ])}
    <g transform="translate(540 1300) scale(1.34) translate(-512 -512)">
      ${bust('sleepy')}
    </g>
    <rect x="0" y="0" width="1080" height="1920" fill="none" stroke="#7FD8FF" stroke-opacity=".16" stroke-width="10"/>
  </svg>`;
}

function coverTideSVG() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="1080" viewBox="0 0 1440 1080">
    ${DEFS}
    <defs>
      <linearGradient id="tbg" x1="0" y1="0" x2="0.4" y2="1">
        <stop offset="0%" stop-color="#F4FBFF"/>
        <stop offset="55%" stop-color="#C9EBFF"/>
        <stop offset="100%" stop-color="#7FD8FF"/>
      </linearGradient>
      <linearGradient id="paper" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#FFFFFF" stop-opacity=".96"/>
        <stop offset="100%" stop-color="#EAF6FF" stop-opacity=".9"/>
      </linearGradient>
    </defs>
    <rect width="1440" height="1080" fill="url(#tbg)"/>
    <g fill="none" stroke="#FFFFFF" stroke-opacity=".85">
      <path d="M-40 820 Q170 742 360 806 T760 800 T1160 812 T1500 790" stroke-width="26"/>
      <path d="M-40 892 Q190 820 400 878 T820 872 T1220 884 T1500 862" stroke-width="16" opacity=".7"/>
      <path d="M-40 952 Q220 892 440 938 T860 934 T1260 944 T1500 926" stroke-width="10" opacity=".5"/>
    </g>
    ${whaleSilhouette(120, 700, 1.35, 0.18)}
    <g>
      <g transform="translate(150 210) rotate(-6)">
        <rect width="480" height="300" rx="28" fill="url(#paper)" stroke="#7FD8FF" stroke-opacity=".4" stroke-width="3"/>
        <rect x="44" y="56" width="220" height="22" rx="11" fill="#4A7BE0" opacity=".55"/>
        <rect x="44" y="108" width="372" height="12" rx="6" fill="#2A4C8F" opacity=".28"/>
        <rect x="44" y="140" width="330" height="12" rx="6" fill="#2A4C8F" opacity=".22"/>
        <rect x="44" y="172" width="360" height="12" rx="6" fill="#2A4C8F" opacity=".2"/>
        <rect x="44" y="226" width="120" height="36" rx="18" fill="#7FD8FF" opacity=".6"/>
      </g>
      <g transform="translate(236 560) rotate(5)">
        <rect width="420" height="260" rx="26" fill="url(#paper)" stroke="#7FD8FF" stroke-opacity=".4" stroke-width="3"/>
        <rect x="40" y="48" width="180" height="20" rx="10" fill="#4A7BE0" opacity=".5"/>
        <rect x="40" y="96" width="330" height="11" rx="5.5" fill="#2A4C8F" opacity=".26"/>
        <rect x="40" y="126" width="300" height="11" rx="5.5" fill="#2A4C8F" opacity=".2"/>
        <rect x="40" y="156" width="322" height="11" rx="5.5" fill="#2A4C8F" opacity=".18"/>
        <rect x="40" y="200" width="96" height="32" rx="16" fill="#7FD8FF" opacity=".55"/>
      </g>
    </g>
    <g transform="translate(1064 612) scale(0.94) translate(-512 -512)">
      ${bust('smile')}
    </g>
    ${bubbles([
      [1240, 220, 18, 0.5],
      [1330, 880, 13, 0.45],
      [960, 200, 9, 0.4],
    ])}
    <rect width="1440" height="1080" fill="none" stroke="#FFFFFF" stroke-opacity=".5" stroke-width="8"/>
  </svg>`;
}

function badgeSVG() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
    <defs>
      <linearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#B4F4FF"/>
        <stop offset="50%" stop-color="#7FD8FF"/>
        <stop offset="100%" stop-color="#6A5CE0"/>
      </linearGradient>
      <radialGradient id="core" cx="50%" cy="42%" r="62%">
        <stop offset="0%" stop-color="#2A4C8F"/>
        <stop offset="100%" stop-color="#081227"/>
      </radialGradient>
    </defs>
    <circle cx="256" cy="256" r="248" fill="url(#ring)"/>
    <circle cx="256" cy="256" r="222" fill="url(#core)"/>
    <circle cx="256" cy="256" r="222" fill="none" stroke="#DFF8FF" stroke-opacity=".45" stroke-width="3"/>
    <circle cx="256" cy="256" r="186" fill="none" stroke="#7FD8FF" stroke-opacity=".35" stroke-width="2" stroke-dasharray="12 14"/>
    <path d="M256 110 C274 176 296 198 362 216 C296 234 274 256 256 322
      C238 256 216 234 150 216 C216 198 238 176 256 110 Z" fill="#DFF8FF"/>
    <path d="M256 142 C268 186 282 200 326 212 C282 224 268 238 256 282
      C244 238 230 224 186 212 C230 200 244 186 256 142 Z" fill="#7FD8FF"/>
    <path d="M256 350 C272 336 292 332 306 340 C294 350 290 364 292 378
      C278 374 266 366 256 350 Z" fill="#9C8CFF"/>
    <circle cx="256" cy="350" r="7" fill="#DFF8FF"/>
    <g fill="#DFF8FF">
      <circle cx="128" cy="330" r="4" opacity=".7"/>
      <circle cx="388" cy="180" r="3.5" opacity=".7"/>
      <circle cx="384" cy="382" r="2.5" opacity=".5"/>
    </g>
  </svg>`;
}

// —— 生成 ——

const jobs = [
  { file: 'avatar_512.png', svg: avatarSVG(), w: 512, h: 512, role: 'avatar' },
  { file: 'portrait_1024x1536.png', svg: portraitSVG(), w: 1024, h: 1536, role: 'portrait' },
  { file: 'cover_radio_1920x1080.png', svg: coverRadioSVG(), w: 1920, h: 1080, role: 'series_cover:radio' },
  { file: 'cover_night_1080x1920.png', svg: coverNightSVG(), w: 1080, h: 1920, role: 'series_cover:night' },
  { file: 'cover_tide_1440x1080.png', svg: coverTideSVG(), w: 1440, h: 1080, role: 'series_cover:tide' },
  { file: 'badge_official_256.png', svg: badgeSVG(), w: 256, h: 256, role: 'badge' },
];

const emojis = [
  ['emoji_01.png', 'smile', '微笑'],
  ['emoji_02.png', 'happy', '开心'],
  ['emoji_03.png', 'shy', '害羞'],
  ['emoji_04.png', 'sleepy', '困困'],
  ['emoji_05.png', 'surprise', '惊讶'],
  ['emoji_06.png', 'sad', '难过'],
  ['emoji_07.png', 'smug', '得意'],
  ['emoji_08.png', 'cheer', '加油'],
];
for (const [file, expr, label] of emojis) {
  jobs.push({ file, svg: emojiSVG(expr), w: 512, h: 512, role: 'emoji', label });
}

const manifest = {
  pack: 'whale-ling-asset-pack',
  character: '鲸凌（鲸鱼娘）',
  codename: 'ELF-W01',
  generated_at: new Date().toISOString(),
  generator: 'docs/assets/gen-whale-ling.mjs（SVG 矢量绘制 + sharp 栅格化）',
  files: [],
};

for (const job of jobs) {
  const name = job.file.replace(/\.png$/, '');
  fs.writeFileSync(path.join(SOURCE, name + '.svg'), job.svg, 'utf8');
  const png = await sharp(Buffer.from(job.svg))
    .resize(job.w, job.h, { fit: 'fill' })
    .png({ compressionLevel: 9 })
    .toBuffer();
  const dest = path.join(VISUAL, job.file);
  fs.writeFileSync(dest, png);
  manifest.files.push({
    path: `visual/${job.file}`,
    role: job.role,
    ...(job.label ? { label: job.label } : {}),
    width: job.w,
    height: job.h,
    bytes: png.length,
    sha256: crypto.createHash('sha256').update(png).digest('hex'),
  });
  console.log('✓', job.file, `${(png.length / 1024).toFixed(1)} KB`);
}

fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log('manifest.json 已写入，共', manifest.files.length, '个文件');
