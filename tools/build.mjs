// Сборка. Запуск: node tools/build.mjs  (или npm run build)
//
// 1) bundle.js: все модули js/*.js в одном обычном скрипте. Его подключает index.html,
//    поэтому приложение открывается двойным кликом (браузеры не грузят ES-модули с file://).
// 2) dist/preview.html: один HTML-файл для быстрого просмотра и публикации страницы.
//
// 3) www/: веб-часть для Capacitor (APK/IPA). Без service worker: в приложении все файлы уже внутри.
//
// После любых правок в js/*.js запускайте сборку заново.
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

// Модули склеиваются в один скрипт: убираем import и export (имена в модулях не пересекаются).
const js = ['js/budget.js', 'js/demo.js', 'js/storage.js', 'js/app.js']
  .map(read)
  .join('\n')
  .replace(/^import .*;\s*$/gm, '')
  .replace(/^export\s+/gm, '');

const bundle = `// Сгенерировано tools/build.mjs из js/*.js. Не редактируйте вручную.
(() => {
${js}
})();
`;
writeFileSync(join(root, 'bundle.js'), bundle);
console.log('bundle.js', bundle.length, 'байт');

const html = read('index.html');
const css = read('css/styles.css');
const body = html
  .split(/<body[^>]*>/)[1]
  .split('</body>')[0]
  .replace(/<script[\s\S]*?<\/script>/g, '')
  .trim();
const fonts = html.match(/<link rel="stylesheet" href="(https:\/\/fonts\.googleapis\.com[^"]+)">/)[1];

const page = `<title>Учёт расходов</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="${fonts}">
<style>
${css}
</style>
${body}
<script>
window.__AUTO_DEMO__ = true;
${bundle}
</script>
`;

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist/preview.html'), page);
console.log('dist/preview.html', page.length, 'байт');

// www/ для Capacitor
const www = join(root, 'www');
rmSync(www, { recursive: true, force: true });
mkdirSync(www, { recursive: true });
for (const item of ['css', 'icons', 'bundle.js']) cpSync(join(root, item), join(www, item), { recursive: true });
writeFileSync(
  join(www, 'index.html'),
  html.replace(/\s*<script src="js\/pwa\.js"[^>]*><\/script>/, '').replace(/\s*<link rel="manifest"[^>]*>/, ''),
);
console.log('www/ готов для Capacitor');
