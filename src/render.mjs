// ep4_blackhole_renewal 결정론 렌더 + 게이트.
// 1080×1920 @25fps · 750f = 30.000s · 12 comp(C0~C11).
// 사용: node render.mjs              대표 프레임 + 결정론 역순 재시크 게이트
//       node render.mjs --all        전 프레임 → frames/
//       node render.mjs --contact    12 comp 컨택트 시트(--gaze 로 시선 오버레이)
//       node render.mjs --spots=f,f  임의 프레임만 → _spot/
import { pathToFileURL } from 'url';
import path from 'path'; import fs from 'fs'; import crypto from 'crypto';
import { spawnSync } from 'child_process';
import { launch, here } from './browser.mjs';

const HERE = here(import.meta.url);

// ★code_data.js 스테일 검사 — 인용 원문이 바뀌면 화면의 줄번호가 거짓이 된다.
{
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(path.join(HERE, 'lens_engine.js')));
  const want = h.digest('hex').slice(0, 12);
  const cd = fs.readFileSync(path.join(HERE, 'code_data.js'), 'utf8');
  const got = (cd.match(/SRC_SHA = ([0-9a-f]{12})/) || [])[1];
  if (got !== want)
    throw new Error(`★code_data.js 스테일 (원문 ${want} ≠ 각인 ${got}) — build_codedata.py 를 다시 돌려라`);
  console.log(`code_data.js 대조 PASS  SRC_SHA=${want}`);
}

function rawRgbSha(file) {
  const r = spawnSync('ffmpeg', ['-nostdin', '-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
    { windowsHide: true, maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`ffmpeg raw failed\n${r.stderr}`);
  return crypto.createHash('sha256').update(r.stdout).digest('hex').slice(0, 12);
}

const OUT = path.join(HERE, 'frames');
const ALL = process.argv.includes('--all');
const CONTACT = process.argv.includes('--contact');
const GAZE = process.argv.includes('--gaze');
const SPOTARG = (process.argv.find(a => a.startsWith('--spots=')) || '').slice(8);

const b = await launch(HERE);
const pg = await b.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
pg.on('console', m => { if (m.type() === 'error') console.log('ERR', m.text()); });
pg.on('pageerror', e => console.log('PAGEERR', e.message));
await pg.goto(pathToFileURL(path.join(HERE, 'comp.html')).href, { waitUntil: 'load' });
await pg.waitForFunction('window.__ready === true', null, { timeout: 240000 });

const FPS = await pg.evaluate(() => window.__fps);
const N = await pg.evaluate(() => window.__frames);
const TOT = await pg.evaluate(() => window.__total);
const NB = await pg.evaluate(() => window.__beats);
const COMP = await pg.evaluate(() => window.__comp);
const WSHA = await pg.evaluate(() => window.__wordsSha);
const CSHA = await pg.evaluate(() => window.__codeSha);
const MERGE = await pg.evaluate(() => window.__mergeF());
if (Math.round(TOT * FPS) !== N) throw new Error(`격자 불일치 ${TOT * FPS} vs ${N}`);
console.log(`격자 ${N}f / ${TOT.toFixed(3)}s @${FPS}fps · comp ${NB} · words_sha ${WSHA} · 합류 f${MERGE}`);
fs.mkdirSync(OUT, { recursive: true });
const cv = await pg.$('#cv');

const shot = async (f, file, gaze) => {
  await pg.evaluate(x => window.__seekF(x), f);
  if (gaze) await pg.evaluate(x => window.__drawGaze(x), f);
  await cv.screenshot({ path: file });
};

if (SPOTARG) {
  const dir = path.join(HERE, '_spot'); fs.mkdirSync(dir, { recursive: true });
  for (const s of SPOTARG.split(',')) {
    const f = parseInt(s, 10);
    await shot(f, path.join(dir, `f${String(f).padStart(4, '0')}.png`), GAZE);
  }
  console.log('_spot/ 완료', SPOTARG);
} else if (CONTACT) {
  const dir = path.join(HERE, '_contact'); fs.mkdirSync(dir, { recursive: true });
  const LF = parseInt((process.argv.find(a => a.startsWith('--lf=')) || '--lf=20').slice(5), 10);
  const shots = [];
  for (let k = 0; k < NB; k++) {
    const f = COMP[k].f0 + Math.min(LF, COMP[k].len - 1);
    const p = path.join(dir, `c${String(k).padStart(2, '0')}_f${String(f).padStart(4, '0')}.png`);
    await shot(f, p, GAZE);
    shots.push(p);
  }
  const sheet = path.join(HERE, GAZE ? 'contact_sheet_gaze.png' : `contact_sheet_lf${LF}.png`);
  const args = ['-y', '-v', 'error'];
  for (const s of shots) args.push('-i', s);
  args.push('-filter_complex', `${shots.map((_, i) => `[${i}:v]scale=270:480[v${i}];`).join('')}` +
    `${shots.map((_, i) => `[v${i}]`).join('')}xstack=inputs=${shots.length}:layout=` +
    shots.map((_, i) => `${(i % 4) * 270}_${Math.floor(i / 4) * 480}`).join('|'), sheet);
  const r = spawnSync('ffmpeg', args, { windowsHide: true });
  if (r.status !== 0) console.log(r.stderr.toString().slice(-800));
  console.log('컨택트 시트 →', sheet);
} else if (ALL) {
  const t0 = Date.now();
  for (let f = 0; f < N; f++) {
    await shot(f, path.join(OUT, `f${String(f).padStart(4, '0')}.png`));
    if (f % 50 === 0) console.log(`  f${f}/${N}  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }
  console.log(`전 프레임 완료 ${N}f  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
} else {
  // ★결정론 게이트 — 컴프 경계·중앙·말미를 정순으로 찍고, 역순으로 다시 찍어 픽셀 SHA 대조
  const probes = [];
  for (const c of COMP) { probes.push(c.f0); probes.push(c.f0 + Math.floor(c.len / 2)); }
  probes.push(N - 1, MERGE);
  const uniq = [...new Set(probes)].sort((a, b2) => a - b2);
  const dir = path.join(HERE, '_det'); fs.mkdirSync(dir, { recursive: true });
  const fwd = {};
  for (const f of uniq) {
    const p = path.join(dir, `a${f}.png`); await shot(f, p); fwd[f] = rawRgbSha(p);
  }
  let pass = 0, fail = 0;
  for (const f of [...uniq].reverse()) {
    const p = path.join(dir, `b${f}.png`); await shot(f, p);
    const s = rawRgbSha(p);
    if (s === fwd[f]) pass++; else { fail++; console.log(`  ★FAIL f${f}  ${fwd[f]} ≠ ${s}`); }
  }
  console.log(`결정론 역순 재시크  ${pass}/${uniq.length} PASS  (FAIL ${fail})`);
  // ★G7 — 컴프 주 애니메이션이 컷보다 먼저 끝나는가
  let g7 = 0;
  for (const c of COMP) {
    const pEnd = await pg.evaluate(f => window.__progress(f), c.f0 + c.len - 11);
    const ok = pEnd >= 0.999;
    if (ok) g7++; else console.log(`  ★G7 FAIL C${c.i} p(끝-11f)=${pEnd.toFixed(3)}`);
  }
  console.log(`G7 완결 여유  ${g7}/${COMP.length} PASS`);
  if (fail) process.exitCode = 1;
}
await b.close();
