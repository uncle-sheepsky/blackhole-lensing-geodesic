// verify.mjs — 이 영상이 화면에서 한 주장을 **코드가 검사한다**.
//
// 브라우저 없이 도는 순수 JS 검사 6종. `node verify.mjs`
// 각 검사는 나레이션·자막의 어느 문장을 검증하는지 같이 찍는다.
import { pathToFileURL } from 'url';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
await import(pathToFileURL(path.join(HERE, 'lens_engine.js')).href);
await import(pathToFileURL(path.join(HERE, 'geodesic.js')).href);
await import(pathToFileURL(path.join(HERE, 'infall_engine.js')).href);
const LE = globalThis.LensEngine, GE = globalThis.Geodesic, IE = globalThis.InfallEngine;

const RS = LE.RS, M = RS / 2;                 // 이 엔진의 단위계: acc = −1.5·h²·r/|r|⁵ ⇒ M = Rs/2
const BCRIT = 3 * Math.sqrt(3) * M;           // 임계 임팩트 파라미터 = 3√3·M = 2.598 Rs
let pass = 0, fail = 0;
const ok = (name, cond, detail, claim) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}\n      ${detail}\n      ↳ 검증 대상: ${claim}\n`);
};

// 멀리서 임팩트 파라미터 b 로 쏘는 광선(약장 극한 검사용)
function farRay(b, R = 400) {
  const cam = [b, 0, -R];
  return { cam, dir: [0, 0, 1] };
}

// ── 1. 결정론 — 같은 입력이면 비트까지 같다 ───────────────────────────────
{
  const r = farRay(6);
  const a = GE.traceGeodesic(r.cam, r.dir, { steps: 4000 });
  const b = GE.traceGeodesic(r.cam, r.dir, { steps: 4000 });
  const same = a.path.length === b.path.length &&
    a.path.every((p, i) => p[0] === b.path[i][0] && p[1] === b.path[i][1] && p[2] === b.path[i][2]);
  const i1 = IE.bake({ frames: 60 }), i2 = IE.bake({ frames: 60 });
  const sameI = i1.pos.length === i2.pos.length && i1.pos.every((v, k) => v === i2.pos[k]);
  ok('1 결정론', same && sameI,
    `측지선 ${a.path.length}점 비트 동일=${same} · 인폴 베이크 ${i1.pos.length}값 비트 동일=${sameI}`,
    '「__seekTo(f) 하면 그 프레임이 딱 나온다」 — 화면은 f 의 순수함수다');
}

// ── 2. 약장 편향각 → 4M/b ────────────────────────────────────────────────
{
  // ★4M/b 는 **약장 1차항**이다. b 가 작아지면 2차항 15πM²/4b² 가 붙는다 —
  //   b=30 에서 1차항만 쓰면 5.2% 어긋나는데, 그건 엔진이 틀린 게 아니라 **비교식이 모자란** 것이다.
  //   ⇒ 1차항 판정은 진짜 약장(b≥60)에서만 하고, 전 구간은 2차항까지 넣어 대조한다.
  const rows = [];
  for (const b of [30, 60, 120, 240]) {
    const r = farRay(b, 3000);
    const d = GE.deflection(r.cam, r.dir, { steps: 60000, dt: 0.5 });
    const t1 = 4 * M / b;
    const t2 = t1 + 15 * Math.PI * M * M / (4 * b * b);
    rows.push([b, d, t1, t2, Math.abs(d - t1) / t1, Math.abs(d - t2) / t2]);
  }
  const worst1 = Math.max(...rows.filter(r => r[0] >= 60).map(r => r[4]));
  const worst2 = Math.max(...rows.map(r => r[5]));
  ok('2 약장 편향각 → 4M/b', worst1 < 0.03 && worst2 < 0.01,
    rows.map(([b, d, t1, t2, e1, e2]) =>
      `b=${b}: 실측 ${(d * 1e3).toFixed(3)}mrad · 1차 4M/b ${(t1 * 1e3).toFixed(3)} (${(e1 * 100).toFixed(2)}%) `
      + `· 2차까지 ${(t2 * 1e3).toFixed(3)} (${(e2 * 100).toFixed(2)}%)`).join('\n      ')
    + `\n      판정: b≥60 1차항 오차 ≤${(worst1 * 100).toFixed(2)}% · 전 구간 2차항 오차 ≤${(worst2 * 100).toFixed(2)}%`,
    '「블랙홀 옆을 지날 때마다 조금씩 꺾어 준다」 — 꺾이는 양이 일반상대론 값과 맞는가');
}

// ── 3. 임계 임팩트 파라미터 = 3√3·M ──────────────────────────────────────
{
  let lo = 1.0, hi = 6.0;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const r = farRay(mid, 300);
    const t = GE.traceGeodesic(r.cam, r.dir, { steps: 20000, dt: 0.1, noPath: true });
    if (t.captured) lo = mid; else hi = mid;
  }
  const got = (lo + hi) / 2, err = Math.abs(got - BCRIT) / BCRIT;
  ok('3 임계 임팩트 파라미터', err < 0.01,
    `포획 경계 b = ${got.toFixed(4)} Rs · 이론 3√3·M = ${BCRIT.toFixed(4)} Rs (오차 ${(err * 100).toFixed(3)}%)`,
    '화면의 「b_crit = 2.598 Rs」 — 그 숫자가 이 엔진에서 실제로 맞는가');
}

// ── 4. 2차상 — 적도면을 2회 지나는 광선이 실재하고 아래 초승달을 이룬다 ────
{
  const W = 1080, H = 1920;
  const cam = LE.camera({ zoom: 1.14, incl: 72 * Math.PI / 180, az: 0.34, fov: 1.15 });
  const dirFromPx = (c, sx, sy) => {
    const ux = (sx - 0.5 * W) / H, uy = (0.5 * H - sy) / H;
    const d = [c.fwd[0] + c.fov * (ux * c.rgt[0] + uy * c.upv[0]),
               c.fwd[1] + c.fov * (ux * c.rgt[1] + uy * c.upv[1]),
               c.fwd[2] + c.fov * (ux * c.rgt[2] + uy * c.upv[2])];
    const n = Math.hypot(d[0], d[1], d[2]);
    return [d[0] / n, d[1] / n, d[2] / n];
  };
  const hits = [];
  for (let sy = 200; sy < 1750; sy += 25)
    for (let sx = 40; sx < 1050; sx += 25) {
      const t = GE.traceGeodesic(cam.cam, dirFromPx(cam, sx, sy), { noPath: true });
      if (!t.captured && t.crossings.length >= 2) hits.push([sx, sy]);
    }
  const ys = hits.map(h => h[1]);
  const below = hits.filter(h => h[1] > H / 2).length;
  ok('4 2차상(적도면 2회 통과)', hits.length > 40 && below / hits.length > 0.9,
    `2회 통과 픽셀 ${hits.length}개 · y 범위 ${Math.min(...ys)}~${Math.max(...ys)} · `
    + `그림자 아래쪽 비율 ${(100 * below / hits.length).toFixed(1)}%`,
    '「뒤에 있던 원반이 위아래로 감겨 보입니다」 · 화면의 「아래 초승달 = 블랙홀 뒤쪽 원반」');
}

// ── 5. 도플러 빔잉 — 다가오는 쪽이 밝다 (셰이더와 같은 식) ────────────────
{
  const cam = LE.camera({ zoom: 1.14, incl: 72 * Math.PI / 180, az: 0.34, fov: 1.15 });
  const beam = (sign) => {
    const rd = 5.0;
    const ang = Math.atan2(cam.cam[0], cam.cam[2]) + sign * Math.PI / 2;
    const xp = [rd * Math.sin(ang), 0, rd * Math.cos(ang)];
    const vd = [-xp[2], 0, xp[0]];
    const vn = Math.hypot(vd[0], vd[2]);
    const tc = [cam.cam[0] - xp[0], cam.cam[1], cam.cam[2] - xp[2]];
    const tn = Math.hypot(tc[0], tc[1], tc[2]);
    const mu = (vd[0] / vn * tc[0] + vd[2] / vn * tc[2]) / tn;
    const beta = Math.min(0.72, 0.46 * Math.sqrt(RS / rd));
    const gam = 1 / Math.sqrt(1 - beta * beta);
    return { beam: Math.pow(1 / (gam * (1 - beta * mu)), 3), mu };
  };
  const a = beam(+1), b = beam(-1);
  const near = a.mu > 0 ? a : b, far = a.mu > 0 ? b : a;
  ok('5 도플러 빔잉', near.beam > far.beam * 1.5,
    `다가오는 쪽 ×${near.beam.toFixed(3)} (mu ${near.mu.toFixed(3)}) vs 멀어지는 쪽 ×${far.beam.toFixed(3)} `
    + `(mu ${far.mu.toFixed(3)}) = ${(near.beam / far.beam).toFixed(2)}배`,
    '「다가오는 쪽은 밝고 푸르게, 멀어지는 쪽은 어둡고 붉게」 — 화면 라벨의 배수와 같은 식');
}

// ── 6. 인폴 Verlet — 항력 0 이면 각운동량 보존, 항력 있으면 반경 단조 감소 ─
{
  const L = IE.angularMomentumSeries({ drag: 0, frames: 400, count: 8 }, 3);
  const rel = (Math.max(...L) - Math.min(...L)) / (L.reduce((a, x) => a + x, 0) / L.length);
  // ★생존 검사 시점은 200프레임이다 — 470프레임까지 돌리면 **전부 삼켜져** 표본이 0 이 된다
  //   (실측: rel399 에서 생존 0). 표본이 0 인데 100% 라고 찍는 게 제일 나쁜 게이트다.
  const FR = 200;
  const b = IE.bake({ frames: FR });
  const rAt = (f, i) => { const o = (f * b.count + i) * 3; return Math.hypot(b.pos[o], b.pos[o + 1], b.pos[o + 2]); };
  let mono = 0, tot = 0;
  for (let i = 0; i < b.count; i++) {
    if (!b.alive[(FR - 1) * b.count + i]) continue;
    tot++;
    // 이심률 때문에 프레임 단위로는 출렁인다 — **처음 60프레임 평균 vs 마지막 60프레임 평균**을 본다.
    // ⚠3구간 단조(0-60 > 70-130 > 140-199)로 걸면 이심 궤도가 중간에 한 번 부풀어 92.7% 가 된다.
    //   주장은 「빨려든다」이지 「매 순간 줄어든다」가 아니다 — 지표를 주장에 맞춘다.
    const avg = (a2, b2) => { let s = 0; for (let f = a2; f < b2; f++) s += rAt(f, i); return s / (b2 - a2); };
    if (avg(0, 60) > avg(FR - 60, FR)) mono++;
  }
  ok('6 인폴 Verlet', rel < 1e-3 && tot >= 30 && mono === tot,
    `항력 0 각운동량 상대변동 ${(rel * 1e6).toFixed(2)} ppm · 항력 有 생존 ${tot}개 중 `
    + `평균반경 단조감소 ${mono}개 (${(100 * mono / tot).toFixed(1)}%)`,
    '「빨려드는 별은 셰이더가 아니라, 중력을 미리 적분해 둔 값이에요」');
}

console.log(`${pass} PASS / ${fail} FAIL`);
process.exitCode = fail ? 1 : 0;
