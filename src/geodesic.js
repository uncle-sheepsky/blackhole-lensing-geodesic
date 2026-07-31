/* geodesic.js — 광자 측지선 적분기 (JS). lens_engine.js 의 GLSL `trace()` 와 **같은 식**.
 *
 * 왜 두 벌인가: 화면에 「이 광선이 이렇게 휘었다」를 선으로 그리려면 CPU 쪽에도 경로가 있어야 한다.
 * 두 구현이 같은 상수·같은 갱신식을 쓰는 것이 이 편의 정직 조건이라, 상수는 LensEngine 에서 받는다.
 *
 *   acc = -1.5 · h² · pos / r⁵      (h = |pos × vel| = 보존되는 각운동량)
 *   vel += acc·dt ; pos += vel·dt   (셰이더와 동일한 심플렉틱 오일러 순서)
 *
 * 반환: { path, captured, minR, crossings }
 *   crossings = 적도면(y=0) 교차점 목록. 길이 ≥2 면 그 광선이 원반을 두 번 이상 본 것 = 2차상.
 */
(function (global) {
  'use strict';

  function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function norm(a) { const n = Math.hypot(a[0], a[1], a[2]); return [a[0] / n, a[1] / n, a[2] / n]; }

  function traceGeodesic(cam, dir, opt) {
    const L = global.LensEngine;
    const steps = (opt && opt.steps) || L.STEPS;
    const dt = (opt && opt.dt) || L.DT;
    const rs = (opt && opt.rs !== undefined) ? opt.rs : L.RS;
    const diskIn = (opt && opt.diskIn !== undefined) ? opt.diskIn : L.DISK_IN;
    const diskOut = (opt && opt.diskOut !== undefined) ? opt.diskOut : L.DISK_OUT;

    const noPath = !!(opt && opt.noPath);      // 화면 탐색용 — 경로 배열을 안 만들어 훨씬 싸다
    let pos = cam.slice(), vel = norm(dir);
    const hv = cross(pos, vel), h2 = dot(hv, hv);
    const path = noPath ? [] : [pos.slice()];
    const crossings = [];
    let captured = false, minR = Infinity;

    for (let i = 0; i < steps; i++) {
      const r2 = dot(pos, pos), r = Math.sqrt(r2);
      if (r < minR) minR = r;
      if (r < rs) { captured = true; break; }
      const k = -1.5 * h2 / (r2 * r2 * r);
      const prev = pos.slice();
      vel = [vel[0] + k * pos[0] * dt, vel[1] + k * pos[1] * dt, vel[2] + k * pos[2] * dt];
      pos = [pos[0] + vel[0] * dt, pos[1] + vel[1] * dt, pos[2] + vel[2] * dt];
      if (!noPath) path.push(pos.slice());
      if (prev[1] * pos[1] < 0) {
        const tc = prev[1] / (prev[1] - pos[1]);
        const xp = [prev[0] + (pos[0] - prev[0]) * tc, 0, prev[2] + (pos[2] - prev[2]) * tc];
        const rd = Math.hypot(xp[0], xp[2]);
        if (rd > diskIn && rd < diskOut) crossings.push({ p: xp, r: rd, step: i });
      }
    }
    return { path, captured, minR, crossings, h2 };
  }

  /** 편향각(라디안) — 들어온 방향과 나간 방향 사이 각. 포획되면 null. */
  function deflection(cam, dir, opt) {
    const g = traceGeodesic(cam, dir, opt);
    if (g.captured || g.path.length < 3) return null;
    const n = g.path.length;
    const out = norm([g.path[n - 1][0] - g.path[n - 2][0],
                      g.path[n - 1][1] - g.path[n - 2][1],
                      g.path[n - 1][2] - g.path[n - 2][2]]);
    const inn = norm(dir);
    return Math.acos(Math.max(-1, Math.min(1, dot(inn, out))));
  }

  /** 임팩트 파라미터 b = |cam × dir| (dir 정규화 기준) — 곧 √h². */
  function impactParam(cam, dir) {
    return Math.sqrt(dot(cross(cam, norm(dir)), cross(cam, norm(dir))));
  }

  global.Geodesic = { traceGeodesic, deflection, impactParam };
})(typeof window !== 'undefined' ? window : globalThis);
