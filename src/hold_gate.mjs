// hold_gate.mjs — G6 컴프 유지 시간.
//
// ◆지시 ② 「완결되기 전에 끊기지 않도록」의 픽셀 판본:
//   컴프의 **상시 모션**(렌징 공전·별 궤도·자막 워드싱크)을 `__setFreeze(true)` 로 고정한 뒤,
//   각 프레임을 그 컴프의 마지막 프레임과 비교해 **언제부터 잠잠해지는지**를 잰다.
//   잠잠해진 시점부터 컴프 끝까지가 유지 시간이고, 하한은 0.40s(ep16 채택값).
//
// ★상시 모션을 안 고정하면 지표가 오염된다 — ep15 에서 이 지표가 두 번 오염됐다
//   (몽타주·HUD·커서 이동을 「결함」으로 셌다). 「변해도 되는 것」을 먼저 정의해야 참값이 나온다.
//
// ★래스터는 **GPU**로 돈다(DET_SW=0). 이 게이트는 결정론이 아니라 **변화량**을 재므로
//   GPU 의 Δ4/255 잡음은 임계(2.0) 아래이고, 750 프레임을 2시간이 아니라 3분에 끝낸다.
process.env.DET_SW = '0';
import { pathToFileURL } from 'url';
import path from 'path'; import fs from 'fs';
import { launch, here } from './browser.mjs';

const HERE = here(import.meta.url);
const THRESH = 2.0;          // 평균 |Δ| 이 이보다 작으면 「멈춘 것」으로 본다
const HOLD_MIN = 0.40;

const b = await launch(HERE);
const pg = await b.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
pg.on('pageerror', e => console.log('PAGEERR', e.message));
await pg.goto(pathToFileURL(path.join(HERE, 'comp.html')).href, { waitUntil: 'load' });
await pg.waitForFunction('window.__ready === true', null, { timeout: 240000 });
await pg.evaluate(() => window.__setFreeze(true));

const FPS = await pg.evaluate(() => window.__fps);
const COMP = await pg.evaluate(() => window.__comp);

// 캔버스 픽셀을 페이지 안에서 직접 비교한다(스크린샷 왕복 없이 = 빠르다)
await pg.evaluate(() => {
  const cv = document.getElementById('cv');
  const oc = document.createElement('canvas'); oc.width = cv.width; oc.height = cv.height;
  const og = oc.getContext('2d', { willReadFrequently: true });
  window.__grab = () => {
    og.drawImage(cv, 0, 0);
    return og.getImageData(0, 0, cv.width, cv.height).data;
  };
  window.__ref = null;
  window.__setRef = () => { window.__ref = new Uint8ClampedArray(window.__grab()); };
  window.__diffRef = () => {
    const a = window.__grab(), r = window.__ref;
    let s = 0;
    for (let i = 0; i < a.length; i += 4) s += Math.abs(a[i] - r[i]) + Math.abs(a[i + 1] - r[i + 1]) + Math.abs(a[i + 2] - r[i + 2]);
    return s / (a.length / 4) / 3;
  };
});

const rows = [];
let pass = 0;
for (const c of COMP) {
  const last = c.f0 + c.len - 1;
  await pg.evaluate(f => window.__seekF(f), last);
  await pg.evaluate(() => window.__setRef());
  let settle = last;                       // 이 프레임부터 마지막까지 잠잠하다
  for (let f = c.f0; f < last; f++) {
    await pg.evaluate(x => window.__seekF(x), f);
    const d = await pg.evaluate(() => window.__diffRef());
    if (d < THRESH) { settle = f; break; }
  }
  const hold = (last - settle + 1) / FPS;
  const ok = hold >= HOLD_MIN;
  pass += ok;
  rows.push({ i: c.i, key: c.key, len: c.len, settle_lf: settle - c.f0, hold, ok });
  console.log(`  C${String(c.i).padStart(2, '0')} ${c.key.padEnd(9)} len ${String(c.len).padStart(3)}f  `
    + `정지 시작 lf${String(settle - c.f0).padStart(3)}  유지 ${hold.toFixed(2)}s  ${ok ? 'PASS' : '★FAIL'}`);
}
const hs = rows.map(r => r.hold);
console.log(`\nG6 컴프 유지 시간  ${pass}/${rows.length} PASS · 최소 ${Math.min(...hs).toFixed(2)}s `
  + `· 평균 ${(hs.reduce((a, x) => a + x, 0) / hs.length).toFixed(2)}s  (하한 ${HOLD_MIN}s · 임계 Δ${THRESH})`);
fs.writeFileSync(path.join(HERE, 'hold_report.json'),
  JSON.stringify({ thresh: THRESH, hold_min: HOLD_MIN, rows }, null, 1));
await b.close();
if (pass !== rows.length) process.exitCode = 1;
