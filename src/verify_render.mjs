// verify_render.mjs — 「이 패키지로 다시 구우면 같은 그림이 나온다」를 **픽셀로** 증명한다.
//
// 사용: node verify_render.mjs [--frames a,b,c] [--ref <디렉토리>]
//   --ref 를 주면 그 디렉토리의 f%04d.png 와 sha256 을 대조하고, 안 주면 굽기만 하고 sha 를 찍는다.
// 작업 트리에서: node verify_render.mjs --ref frames
// 공개 저장소에서: node verify_render.mjs        (README 의 기대 sha 와 눈으로 대조)
import { pathToFileURL } from 'url';
import path from 'path'; import fs from 'fs'; import crypto from 'crypto';
import { launch, here } from './browser.mjs';

const HERE = here(import.meta.url);
const arg = k => (process.argv.find(a => a.startsWith(k + '=')) || '').split('=')[1];
const FRAMES = (arg('--frames') || '0,124,174,299,424,574,749').split(',').map(Number);
const REF = arg('--ref');

const OUT = path.join(HERE, '_repro');
fs.mkdirSync(OUT, { recursive: true });

const b = await launch(HERE);
const pg = await b.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
pg.on('pageerror', e => console.log('PAGEERR', e.message));
await pg.goto(pathToFileURL(path.join(HERE, 'comp.html')).href, { waitUntil: 'load' });
await pg.waitForFunction('window.__ready === true', null, { timeout: 240000 });
const cv = await pg.$('#cv');

const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
let pass = 0, fail = 0;
for (const f of FRAMES) {
  const p = path.join(OUT, `f${String(f).padStart(4, '0')}.png`);
  await pg.evaluate(x => window.__seekF(x), f);
  await cv.screenshot({ path: p });
  const got = sha(p);
  if (REF) {
    const rp = path.isAbsolute(REF) ? REF : path.join(HERE, REF);
    const r = path.join(rp, `f${String(f).padStart(4, '0')}.png`);
    if (!fs.existsSync(r)) { console.log(`f${f}  ${got.slice(0, 16)}  (기준 없음)`); continue; }
    const want = sha(r);
    const ok = got === want; ok ? pass++ : fail++;
    console.log(`f${String(f).padStart(4, '0')}  ${got.slice(0, 16)}  ${ok ? '== 작업본' : '★≠ ' + want.slice(0, 16)}`);
  } else {
    console.log(`f${String(f).padStart(4, '0')}  ${got}`);
  }
}
if (REF) {
  console.log(`\nPNG sha256 대조  ${pass}/${pass + fail} 동일`);
  if (fail) process.exitCode = 1;
}
await b.close();
