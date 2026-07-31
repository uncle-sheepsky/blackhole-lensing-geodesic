/* infall_engine.js — 빨려드는 별의 궤도. **셰이더가 아니라** 사전 적분한 값이다.
 *
 * 나레 N3 「빨려드는 별은 셰이더가 아니라, 중력을 미리 적분해 둔 값이에요」를
 * 참으로 만드는 자리. 렌징(GPU 셰이더)과 인폴(CPU 적분)은 서로 다른 계산이다.
 *
 *   중력   a_g    = -GM · r / |r|³                  (뉴턴 · 중심 질량 1체)
 *   항력   a_drag = -k · (rRef/r)^q · v             (강착 원반 마찰 근사 = 인스파이럴의 원인)
 *          ★반경 의존이다. 균일 항력(q=0)이면 r(t)=r₀·e^(−2kt) 라 모든 별이 **같은 비율로**
 *            줄어 다 같이 사라진다(실측: 240개가 f149~250 에 몰려 죽었다). 안쪽일수록 마찰이
 *            센 형태로 두면 바깥은 천천히 돌고 안쪽은 급강하한다 = 플런지가 보인다.
 *   적분   속도 Verlet(velocity Verlet) — 반스텝 속도로 위치·가속을 번갈아 갱신
 *
 * ★결정론: 시드 PRNG(mulberry32) 로만 초기조건을 만든다. Math.random 없음.
 * ★검증(재현 패키지 verify.mjs 6번):
 *     drag=0 이면 각운동량 |r × v| 이 보존된다(상대오차 < 1e-6)
 *     drag>0 이면 궤도 반경이 단조 감소한다
 */
(function (global) {
  'use strict';

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const DEFAULTS = {
    // ★수치는 「무엇이 화면에 보이는가」로 정해졌다(실측 스윕):
    //   f300(C5 시작) 240개 생존 · r 3.1/8.1/11.9 → f449(C6 끝) 73개 · r 1.1/5.4/11.1
    //   리드 스타(안쪽 도달) = **f425** — 수기 지정이 아니라 베이크가 낸 값이다.
    seed: 20260731, count: 240, frames: 470, dt: 0.55, drag: 0.010,
    dragRef: 6.0, dragExp: 2.4,
    GM: 1.0, rIn: 4.0, rOut: 12.0, thick: 0.55, rKill: 1.05,
    startFrame: 280,          // 인폴 시작 = C5 진입 20f 전(컷 순간 이미 움직이고 있게)
  };

  /** 궤도를 프레임 단위로 사전 적분한다. 반환 = {pos: Float32Array(frames*count*3), alive: Uint8Array} */
  function bake(opt) {
    const o = Object.assign({}, DEFAULTS, opt || {});
    const rnd = mulberry32(o.seed);
    const n = o.count, F = o.frames;
    const px = new Float64Array(n), py = new Float64Array(n), pz = new Float64Array(n);
    const vx = new Float64Array(n), vy = new Float64Array(n), vz = new Float64Array(n);

    for (let i = 0; i < n; i++) {
      const r = o.rIn + (o.rOut - o.rIn) * rnd();      // 면적가중(√) 이면 바깥에 몰려
                                                       // 원반 밖 헤일로가 된다 — 균등 분포로 안쪽을 채운다
      const th = rnd() * Math.PI * 2;
      const h = (rnd() - 0.5) * 2 * o.thick;
      px[i] = r * Math.cos(th); py[i] = h; pz[i] = r * Math.sin(th);
      // 원궤도 속도(같은 방향 = 원반 회전과 일치) + 약간의 이심률
      const vc = Math.sqrt(o.GM / r) * (0.90 + 0.16 * rnd());
      vx[i] = -Math.sin(th) * vc; vy[i] = (rnd() - 0.5) * 0.012; vz[i] = Math.cos(th) * vc;
    }

    const pos = new Float32Array(F * n * 3);
    const alive = new Uint8Array(F * n);

    const ax = new Float64Array(n), ay = new Float64Array(n), az = new Float64Array(n);
    const dead = new Uint8Array(n);
    const accel = (i) => {
      const r2 = px[i] * px[i] + py[i] * py[i] + pz[i] * pz[i];
      const r = Math.sqrt(r2), k = -o.GM / (r2 * r);
      const kd = o.drag * Math.pow(o.dragRef / r, o.dragExp);
      ax[i] = k * px[i] - kd * vx[i];
      ay[i] = k * py[i] - kd * vy[i];
      az[i] = k * pz[i] - kd * vz[i];
    };
    for (let i = 0; i < n; i++) accel(i);

    for (let f = 0; f < F; f++) {
      for (let i = 0; i < n; i++) {
        const b = (f * n + i) * 3;
        pos[b] = px[i]; pos[b + 1] = py[i]; pos[b + 2] = pz[i];
        alive[f * n + i] = dead[i] ? 0 : 1;
      }
      const dt = o.dt;
      for (let i = 0; i < n; i++) {
        if (dead[i]) continue;
        // 속도 Verlet: x += v·dt + ½a·dt² → a' → v += ½(a+a')·dt
        px[i] += vx[i] * dt + 0.5 * ax[i] * dt * dt;
        py[i] += vy[i] * dt + 0.5 * ay[i] * dt * dt;
        pz[i] += vz[i] * dt + 0.5 * az[i] * dt * dt;
        const oax = ax[i], oay = ay[i], oaz = az[i];
        accel(i);
        vx[i] += 0.5 * (oax + ax[i]) * dt;
        vy[i] += 0.5 * (oay + ay[i]) * dt;
        vz[i] += 0.5 * (oaz + az[i]) * dt;
        if (Math.hypot(px[i], py[i], pz[i]) < o.rKill) dead[i] = 1;
      }
    }
    return { pos, alive, count: n, frames: F, opt: o };
  }

  /** 검증용 — 한 별의 각운동량 크기 수열. drag=0 이면 상수여야 한다. */
  function angularMomentumSeries(opt, index) {
    const o = Object.assign({}, DEFAULTS, opt || {});
    const b = bake(o);
    const out = [];
    for (let f = 1; f < b.frames; f++) {
      const a = (f * b.count + index) * 3, p = ((f - 1) * b.count + index) * 3;
      const r = [b.pos[a], b.pos[a + 1], b.pos[a + 2]];
      const v = [(b.pos[a] - b.pos[p]) / o.dt, (b.pos[a + 1] - b.pos[p + 1]) / o.dt,
                 (b.pos[a + 2] - b.pos[p + 2]) / o.dt];
      out.push(Math.hypot(r[1] * v[2] - r[2] * v[1], r[2] * v[0] - r[0] * v[2],
                          r[0] * v[1] - r[1] * v[0]));
    }
    return out;
  }

  global.InfallEngine = { bake, angularMomentumSeries, DEFAULTS, mulberry32 };
})(typeof window !== 'undefined' ? window : globalThis);
