/* 出单文件版：把 insight.js 与 jev/*.js 内联进 index.html。
   用法：node harness/build_single.js   →  dist-single/index.html
   为什么要单文件：GitHub Pages / itch / 4399 三边都吃这个形态，且不存在相对路径与
   子目录基址问题（Pages 项目站挂在 /<repo>/ 子路径下，外链脚本最容易在这里翻车）。 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'dist-single');
const ORDER = ['insight.js', 'jev/core.js', 'jev/questions.js', 'jev/policies.js', 'jev/client.js'];

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const tags = ORDER.map((f) => `<script src="${f}"></script>`);
const missing = tags.filter((t) => !html.includes(t));
if (missing.length) { console.error('index.html 里找不到这些引用，构建中止：\n  ' + missing.join('\n  ')); process.exit(1); }

let out = html;
ORDER.forEach((f, i) => {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8').trim();
  if (src.includes('</script>')) { console.error(`${f} 含 </script>，内联会截断文档，构建中止`); process.exit(1); }
  out = out.replace(tags[i], `<script>\n${src}\n</script>`);
});

const leftover = [...out.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
if (leftover.length) { console.error('仍有外链脚本：' + leftover.join(', ')); process.exit(1); }

fs.mkdirSync(OUT_DIR, { recursive: true });
const dest = path.join(OUT_DIR, 'index.html');
fs.writeFileSync(dest, out);
const kb = (fs.statSync(dest).size / 1024).toFixed(1);
console.log(`已生成 ${path.relative(ROOT, dest)} · ${kb} KB · 外链脚本 0 个`);
console.log('可直接：GitHub Pages 丢这一个文件，或 itch/4399 打包成 zip（index.html 在根）');
