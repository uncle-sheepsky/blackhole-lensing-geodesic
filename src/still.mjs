// still.mjs — 임의 각도의 블랙홀 정지 프레임을 PNG 로 굽는다.
//
//   node still.mjs                       기본 3장(incl 76 / 32 / 88) → out/
//   node still.mjs --incl=20,45,70       각도 목록
//   node still.mjs --zoom=1.6 --size=1440
//
// ★같은 인자 → 같은 PNG. 두 번 돌려 sha256 을 대조하면 같아야 한다(아래 --check).
//   `--check` 는 각 장을 두 번 굽고 픽셀 SHA 를 비교한다.
import { pathToFileURL, fileURLToPath } from 'url';
import path from 'path'; import fs from 'fs'; import crypto from 'crypto';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => {
  const a = process.argv.find(s => s.startsWith('--' + k + '='));
  return a ? a.split('=')[1] : d;
};
const INCL = String(arg('incl', '76,32,88')).split(',').map(Number);
const AZ = Number(arg('az', 20));
const ZOOM = Number(arg('zoom', 1.30));
const SIZE = Number(arg('size', 1024));
const T = Number(arg('t', 0));
const CHECK = process.argv.includes('--check');
const OUT = path.join(HERE, '..', 'out');

// ★소프트웨어 래스터가 기본이다. 실 GPU 는 드라이버마다 픽셀이 미세하게 갈려
//   「같은 코드 → 같은 픽셀」이 성립하지 않는다(RTX 3060 / ANGLE D3D11 에서 max Δ8/255 실측).
//   빠르게 보기만 할 거면 DET_SW=0.
const SW = process.env.DET_SW !== '0';
const FLAGS = ['--disable-lcd-text', '--disable-font-subpixel-positioning',
  '--force-color-profile=srgb', '--disable-partial-raster', '--disable-skia-runtime-opts',
  '--disable-gpu-rasterization', '--allow-file-access-from-files']
  .concat(SW ? ['--use-gl=angle', '--use-angle=swiftshader', '--disable-gpu'] : []);

const { chromium } = await import('playwright');
// 번들 크로미움이 없으면 시스템 브라우저로 떨어진다(`npx playwright install` 을 안 돌린 환경 대비)
const SYSTEM = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
];
let b;
try {
  b = await chromium.launch({ args: FLAGS });
} catch (e) {
  const executablePath = SYSTEM.find(p => fs.existsSync(p));
  if (!executablePath) throw e;
  console.log('번들 크로미움 없음 → 시스템 브라우저 사용:', executablePath);
  b = await chromium.launch({ executablePath, args: FLAGS });
}
const pg = await b.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1 });
pg.on('pageerror', e => console.log('PAGEERR', e.message));
await pg.goto(pathToFileURL(path.join(HERE, 'blackhole.html')).href, { waitUntil: 'load' });
await pg.evaluate(s => { const c = document.getElementById('cv'); c.width = s; c.height = s; }, SIZE);

fs.mkdirSync(OUT, { recursive: true });
const cv = await pg.$('#cv');
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex').slice(0, 16);

const shot = async (incl, file) => {
  await pg.evaluate(v => {
    for (const k of Object.keys(v)) {
      const e = document.getElementById(k);
      if (e) { e.value = v[k]; e.dispatchEvent(new Event('input')); }
    }
  }, { incl, az: AZ, zoom: ZOOM, t: T });
  await cv.screenshot({ path: file });
};

console.log(`래스터 = ${SW ? 'SwiftShader(결정론)' : 'GPU(빠름·결정론 미보장)'} · ${SIZE}×${SIZE} · az ${AZ} · zoom ${ZOOM}`);
for (const incl of INCL) {
  const p1 = path.join(OUT, `incl${incl}.png`);
  await shot(incl, p1);
  let note = '';
  if (CHECK) {
    const p2 = path.join(OUT, `_recheck_incl${incl}.png`);
    await shot(incl === INCL[0] ? INCL[INCL.length - 1] : INCL[0], path.join(OUT, '_tmp.png')); // 다른 값으로 한 번 흔들고
    await shot(incl, p2);
    const same = sha(p1) === sha(p2);
    note = same ? '  재현 OK' : '  ★재현 실패';
    fs.unlinkSync(p2);
  }
  console.log(`  incl ${String(incl).padStart(3)}  ${sha(p1)}  → out/incl${incl}.png${note}`);
}
if (CHECK && fs.existsSync(path.join(OUT, '_tmp.png'))) fs.unlinkSync(path.join(OUT, '_tmp.png'));
await b.close();
