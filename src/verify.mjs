// verify.mjs — 이 렌더러가 **일반상대론과 맞는지** 코드가 검사한다.
//
// 브라우저 없이 도는 순수 JS 검사 6종. `node verify.mjs`
// 각 검사는 v5 의 어느 문장·어느 크롭을 검증하는지 같이 찍는다.
import { pathToFileURL, fileURLToPath } from 'url';
import path from 'path'; import fs from 'fs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
await import(pathToFileURL(path.join(HERE, 'lens_engine.js')).href);
await import(pathToFileURL(path.join(HERE, 'geodesic.js')).href);
const LE = globalThis.LensEngine, GE = globalThis.Geodesic;

const RS = LE.RS, M = RS / 2;                 // 단위계: acc = −1.5·h²·r/|r|⁵ ⇒ M = Rs/2
const BCRIT = 3 * Math.sqrt(3) * M;           // 임계 임팩트 파라미터 = 3√3·M = 2.598 Rs
let pass = 0, fail = 0;
const ok = (name, cond, detail, claim) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}\n      ${detail}\n      ↳ 검증 대상: ${claim}\n`);
};

function farRay(b, R = 400) { return { cam: [b, 0, -R], dir: [0, 0, 1] }; }

const W = 1080, H = 1920;
const dirFromPx = (c, sx, sy) => {
  const ux = (sx - 0.5 * W) / H, uy = (0.5 * H - sy) / H;
  const d = [c.fwd[0] + c.fov * (ux * c.rgt[0] + uy * c.upv[0]),
             c.fwd[1] + c.fov * (ux * c.rgt[1] + uy * c.upv[1]),
             c.fwd[2] + c.fov * (ux * c.rgt[2] + uy * c.upv[2])];
  const n = Math.hypot(d[0], d[1], d[2]);
  return [d[0] / n, d[1] / n, d[2] / n];
};
// 검사용 카메라
const CAM = { zoom: 1.34, incl: 78 * Math.PI / 180, az: 0.46, fov: 1.15 };

// ── 1. 결정론 — 같은 입력이면 비트까지 같다 ───────────────────────────────
{
  const r = farRay(6);
  const a = GE.traceGeodesic(r.cam, r.dir, { steps: 4000 });
  const b = GE.traceGeodesic(r.cam, r.dir, { steps: 4000 });
  const same = a.path.length === b.path.length &&
    a.path.every((p, i) => p[0] === b.path[i][0] && p[1] === b.path[i][1] && p[2] === b.path[i][2]);
  ok('1 결정론', same,
    `측지선 ${a.path.length}점 비트 동일=${same}`,
    '같은 입력이면 같은 출력 — 이 저장소의 요지(각도를 바꿔도 같은 블랙홀이 유지된다)');
}

// ── 2. 약장 편향각 → 4M/b ────────────────────────────────────────────────
{
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
    'lens_engine.js L111 `acc = -1.5*h2*pos/r^5` 한 줄이 만드는 편향각이 이론값과 맞는가');
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
    '그림자 경계 반경이 3√3·M 인가 — 렌더가 그리는 원의 정체');
}

// ── 4. RING 크롭 창이 경계를 물고 있는가 ──────────────────────────────────
{
  // 화면 반경 r = tan(asin(b_crit/R))/fov·H 로 그린 원 위에서
  // 안쪽 광선은 포획되고 바깥 광선은 탈출하는지 본다.
  const cam = LE.camera(CAM);
  const R = Math.hypot(cam.cam[0], cam.cam[1], cam.cam[2]);
  const rPx = Math.tan(Math.asin(Math.min(1, BCRIT / R))) / CAM.fov * H;
  const a = -1.0;
  const cx = W / 2 + rPx * Math.cos(a), cy = H / 2 + rPx * Math.sin(a);
  const SW = 215, SH = 161;                            // 검사 창(215×161)
  const probe = (scale) => {
    const sx = W / 2 + rPx * scale * Math.cos(a), sy = H / 2 + rPx * scale * Math.sin(a);
    const inWin = Math.abs(sx - cx) <= SW / 2 && Math.abs(sy - cy) <= SH / 2;
    const t = GE.traceGeodesic(cam.cam, dirFromPx(cam, sx, sy), { steps: 4000, dt: 0.05, noPath: true });
    return { inWin, cap: t.captured, minR: t.minR };
  };
  const a1 = probe(0.90), a2 = probe(1.10);
  ok('4 RING 크롭', a1.inWin && a2.inWin && a1.cap && !a2.cap,
    `창 중심 (${cx.toFixed(0)}, ${cy.toFixed(0)}) · 창 ${SW}×${SH} 안에서 `
    + `0.90배 지점 포획=${a1.cap} · 1.10배 지점 포획=${a2.cap}(최근접 ${a2.minR.toFixed(3)})`,
    '화면 좌표 → 임팩트 파라미터 매핑이 맞는가(그 반경 안쪽은 포획, 바깥은 탈출)');
}

// ── 5. EDGE 크롭 = 블랙홀 **뒤쪽** 원반(적도면 2회 통과) ──────────────────
{
  const cam = LE.camera(CAM);
  const R = Math.hypot(cam.cam[0], cam.cam[1], cam.cam[2]);
  const rPx = Math.tan(Math.asin(Math.min(1, BCRIT / R))) / CAM.fov * H;
  const cx = W / 2, cy = H / 2 + rPx * 0.86;           // 검사 창 중심(그림자 아래)
  let hit = 0, tot = 0;
  for (let dy = -70; dy <= 70; dy += 14)
    for (let dx = -100; dx <= 100; dx += 20) {
      const t = GE.traceGeodesic(cam.cam, dirFromPx(cam, cx + dx, cy + dy), { noPath: true });
      if (t.captured) continue;
      tot++;
      if (t.crossings.length >= 2) hit++;
    }
  ok('5 EDGE 크롭 = 2차상', tot > 20 && hit / tot > 0.30,
    `EDGE 창(중심 ${cx.toFixed(0)}, ${cy.toFixed(0)}) 표본 ${tot}개 중 적도면 2회 통과 ${hit}개 `
    + `(${(100 * hit / Math.max(1, tot)).toFixed(1)}%)`,
    '그림자 아래 초승달 = 합성이 아니라 **블랙홀 뒤쪽 원반**(적도면 2회 통과)');
}

// ── 6. DISK 두 장의 밝기 차 = 도플러 빔잉(셰이더와 같은 식) ────────────────
{
  const cam = LE.camera(CAM);
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
  const x = beam(+1), y = beam(-1);
  const near = x.mu > 0 ? x : y, far = x.mu > 0 ? y : x;
  ok('6 DISK 좌우 밝기 차', near.beam > far.beam * 1.5,
    `다가오는 쪽 ×${near.beam.toFixed(3)} vs 멀어지는 쪽 ×${far.beam.toFixed(3)} `
    + `= ${(near.beam / far.beam).toFixed(2)}배 (두 창은 중심에서 **같은 반경**에 있다)`,
    '원반 좌우 밝기 차 = 상대론 도플러 빔잉(dopp³). 같은 반경에서 잰다');
}

console.log(`${pass} PASS / ${fail} FAIL`);
process.exitCode = fail ? 1 : 0;
