// Build the static site for Vercel.
//
//   node tools/build-site.mjs
//
// Scans videos/ for YYYY-MM-DD-<title>.mp4 files, probes each for duration and
// resolution, and emits a static site into dist/:
//   - index.html      list of works (cover + title), newest first
//   - play-<n>.html   one page per work, with a <video> player and a back button
//   - assets/         css + generated covers
//   - videos/         the mp4 files
//
// No runtime dependencies: the output is plain HTML/CSS/JS.
//
// Sorting: date descending, then title ascending by pinyin (GB2312 byte order
// matches pinyin ordering for GB2312-encoded Chinese; the browser's Intl
// Collator is used as a fallback for anything outside GB2312).
import { readdirSync, mkdirSync, copyFileSync, statSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { probeMp4 } from './mp4probe.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VIDEOS = join(ROOT, 'videos');
const POSTERS = join(ROOT, 'posters');
const SRC = join(ROOT, 'site');
const DIST = join(ROOT, 'dist');

const NAME_RE = /^(\d{4})-(\d{2})-(\d{2})-(.+)\.(mp4|mov|webm)$/i;

// --- pinyin ordering ------------------------------------------------------
// GB2312 arranges hanzi by pinyin, so its byte order is the pinyin order.
function pinyinKey(title) {
  try {
    return Buffer.from(title, 'gb2312');
  } catch {
    return Buffer.from(title, 'utf8');
  }
}
const collator = new Intl.Collator('zh-Hans-CN-u-co-pinyin', { sensitivity: 'base' });
function compareTitles(a, b) {
  // Both strings GB2312-encodable -> byte compare is exact pinyin order.
  let ba, bb;
  try { ba = Buffer.from(a, 'gb2312'); bb = Buffer.from(b, 'gb2312'); } catch { ba = bb = null; }
  if (ba && bb) return Buffer.compare(ba, bb);
  return collator.compare(a, b);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtDur(s) {
  if (s === null || s === undefined) return '–';
  const m = Math.floor(s / 60), r = Math.round(s % 60);
  return m ? `${m}′${String(r).padStart(2, '0')}″` : `${r}″`;
}
function fmtSize(b) {
  return (b / 1048576).toFixed(1) + ' MB';
}
function fmtDate(d) {
  const [y, m, dd] = d.split('-');
  return `${y}.${m}.${dd}`;
}

function collect() {
  const items = [];
  const skipped = [];
  for (const fname of readdirSync(VIDEOS)) {
    const m = NAME_RE.exec(fname);
    if (!m) { if (/\.(mp4|mov|webm)$/i.test(fname)) skipped.push(fname); continue; }
    const [, y, mo, d, title] = m;
    const path = join(VIDEOS, fname);
    const info = probeMp4(path);
    items.push({
      file: fname,
      title: title.replace(/_/g, ' '),
      date: `${y}-${mo}-${d}`,
      duration: info.duration,
      width: info.width,
      height: info.height,
      size: statSync(path).size,
    });
  }
  items.sort((a, b) => (a.date === b.date ? compareTitles(a.title, b.title) : (a.date < b.date ? 1 : -1)));
  return { items, skipped };
}

// --- templates ------------------------------------------------------------
const CSS = join(SRC, 'style.css');

function listHtml(items) {
  const total = items.reduce((a, it) => a + (it.duration || 0), 0);
  const cards = items.map((it, i) => {
    const n = String(i + 1).padStart(2, '0');
    const poster = existsSync(join(POSTERS, it.file.replace(/\.[^.]+$/, '.jpg')))
      ? `assets/covers/${encodeURIComponent(it.file.replace(/\.[^.]+$/, '.jpg'))}` : '';
    const bg = poster ? ` style="background-image:url('${poster}')"` : '';
    return `<a class="card" href="play-${n}.html" target="_blank" rel="noopener">
  <div class="thumb"${bg}><span class="num">${n}</span><span class="play">▶</span></div>
  <div class="body">
    <div class="ttl">${esc(it.title)}</div>
    <div class="meta"><span class="dot"></span>${fmtDate(it.date)} · ${fmtDur(it.duration)} · ${fmtSize(it.size)}</div>
  </div>
</a>`;
  }).join('\n');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>作品列表 · AI 内容生成作品集</title>
<meta name="description" content="健康科普赛道竖屏短视频 · ${items.length} 支成片 · 独立完成">
<link rel="stylesheet" href="assets/style.css">
</head>
<body class="page-list">
<header class="bar"><div class="bar-in">
  <a class="brand" href="index.html"><span class="brand-mark"></span><span class="brand-txt">AI 内容生成作品集</span></a>
  <nav class="bar-nav">
    <a class="on" href="index.html">作品列表</a>
    <a href="AI内容生成作品集.pdf" target="_blank" rel="noopener">作品集 PDF</a>
    <a href="https://github.com/Homeyc/ai-video-portfolio" target="_blank" rel="noopener">GitHub</a>
  </nav>
</div></header>
<main class="wrap">
  <div class="kicker">AI Content Generation · Portfolio</div>
  <h1>作品列表</h1>
  <p class="sub">健康科普赛道的竖屏短视频，全部由本人独立完成 —— 使用 <b>WorkBuddy</b> 生成成片，以 <b>Prompt Optimizer</b> 完成提示词结构化迭代。点击任意作品将在新标签页中播放。</p>
  <div class="meta-row">
    <span class="stat"><b>${items.length}</b> 支成片</span>
    <span class="stat"><b>${fmtDur(total)}</b> 总时长</span>
    <span class="stat"><b>1080×1920</b> 竖屏规格</span>
  </div>
  <div class="grid">
${cards}
  </div>
  <p class="foot-note">上传新视频后，本页会在构建时自动同步，无需手动更新。</p>
</main>
</body>
</html>
`;
}

const DESCS = {
  '咖啡因残留': '用「时间轴记账」的框架替代单向说教：把一天拆成「喝下去 / 吃到什么 / 几点躺下 / 睡得如何」四个可自查的账目。5 段主题章节 + 实拍分隔 + 尾卡，含血糖双折线、胃排空时钟、REM 波形等 6 类图表。',
  '椎间盘压力': '以「以站立为 100%」的椎间盘压力曲线开场，再用因果链条图串起「久坐 → 静脉失活 → 髋代偿 → 腰痛」，最后以工位三件事给出出口。28 秒讲完一条完整因果链。',
  '睡眠信号读取': '唯一一支真人实拍与 3D CG 混剪的作品：失眠特写 → 手表心率 / 血氧读数 → 线框人体仰卧 → 脑部渲染，最后以「间接估算 × 直接读取」的对照图讲清可穿戴设备与脑电检测的精度边界。',
  '助眠底层原料': '从咖啡因半衰期曲线出发，四个暖光实拍镜头串起餐桌与肠胃时间点，最后落到「色氨酸 → 5-羟色胺 → 褪黑素」的三级生化路径图。是主打作品同题材的短版衍生内容。',
  '秋冬季节最佳入睡时间': '季节性场景下的行为指南：上床时间往前挪、晨光作为每天的锚、跟着日落定窗口。用「一周之后」的位移曲线量化作息漂移，落到「记一周 / 提前半小时 / 看十五分钟」三步可执行动作。',
};

function playHtml(it, n) {
  const videoUrl = 'videos/' + encodeURIComponent(it.file);
  const coverName = it.file.replace(/\.[^.]+$/, '.jpg');
  const poster = existsSync(join(POSTERS, coverName))
    ? ` poster="assets/covers/${encodeURIComponent(coverName)}"` : '';
  const desc = DESCS[it.title] || '';
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(it.title)} · AI 内容生成作品集</title>
<link rel="stylesheet" href="assets/style.css">
</head>
<body class="page-play">
<header class="bar"><div class="bar-in">
  <a class="back" href="index.html"><span class="back-ico">←</span><span class="back-txt">返回列表</span></a>
  <nav class="bar-nav">
    <a href="index.html">作品列表</a>
    <a href="AI内容生成作品集.pdf" target="_blank" rel="noopener">作品集 PDF</a>
    <a href="https://github.com/Homeyc/ai-video-portfolio" target="_blank" rel="noopener">GitHub</a>
  </nav>
</div></header>
<main class="wrap wrap-play">
  <div class="play-left">
    <div class="stage">
      <video controls playsinline preload="metadata"${poster}>
        <source src="${videoUrl}" type="video/mp4">
        你的浏览器不支持 video 标签，请<a href="${videoUrl}">点此下载原片</a>。
      </video>
    </div>
    <div class="acts">
      <a class="btn" href="${videoUrl}" download>下载原片</a>
      <a class="btn ghost" href="https://github.com/Homeyc/ai-video-portfolio/blob/main/videos/${encodeURIComponent(it.file)}" target="_blank" rel="noopener">在 GitHub 中查看</a>
    </div>
  </div>
  <aside class="play-right">
    <div class="kicker">${fmtDate(it.date)}</div>
    <h1>${esc(it.title)}</h1>
    <div class="meta-row compact">
      <span class="stat"><b>${fmtDur(it.duration)}</b>时长</span>
      <span class="stat"><b>${it.width || '?'}×${it.height || '?'}</b>分辨率</span>
      <span class="stat"><b>${fmtSize(it.size)}</b>文件大小</span>
    </div>
    ${desc ? `<p class="sub play-sub">${esc(desc)}</p>` : ''}
    <div class="panel">
      <h3>这个页面</h3>
      <p class="tiny">播放器直接引用仓库中的成片原片，支持拖动进度条与全屏播放；「下载原片」拿到的是未经剪辑的原始 mp4 文件。</p>
    </div>
  </aside>
</main>
</body>
</html>
`;
}

// --- build ----------------------------------------------------------------
function main() {
  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(join(DIST, 'assets', 'covers'), { recursive: true });
  mkdirSync(join(DIST, 'videos'), { recursive: true });

  const { items, skipped } = collect();

  copyFileSync(CSS, join(DIST, 'assets', 'style.css'));

  // covers
  let covers = 0;
  for (const it of items) {
    const src = join(POSTERS, it.file.replace(/\.[^.]+$/, '.jpg'));
    if (existsSync(src)) {
      copyFileSync(src, join(DIST, 'assets', 'covers', it.file.replace(/\.[^.]+$/, '.jpg')));
      covers++;
    }
  }

  // videos
  for (const it of items) {
    copyFileSync(join(VIDEOS, it.file), join(DIST, 'videos', it.file));
  }

  // pages
  writeFileSync(join(DIST, 'index.html'), listHtml(items), 'utf8');
  items.forEach((it, i) => {
    writeFileSync(join(DIST, `play-${i + 1}.html`), playHtml(it, i + 1), 'utf8');
  });

  // extra files carried along
  for (const extra of ['AI内容生成作品集.pdf', 'qr_portfolio.png']) {
    const src = join(ROOT, extra);
    if (existsSync(src)) copyFileSync(src, join(DIST, extra));
  }

  console.log(`built ${items.length} works, ${covers} covers, ${items.length} videos -> dist/`);
  items.forEach((it, i) => {
    console.log(`  ${String(i + 1).padStart(2, '0')} ${it.date}  ${it.title}  ${fmtDur(it.duration)}`);
  });
  if (skipped.length) {
    console.log(`  SKIPPED (expected YYYY-MM-DD-title.mp4): ${skipped.join(', ')}`);
  }
}

main();
