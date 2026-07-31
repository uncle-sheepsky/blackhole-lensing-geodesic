/* beats4.js — ep4_blackhole_renewal 연출 정본.
 *
 * 12 컴프 · 750f · 30.000s @25fps · BPM120(1마디 50f · 1박 12.5f).
 * 값의 진실원은 편-계약.json 이고, 이 파일은 그 값을 **화면 언어로 옮긴 것**이다.
 * 숫자를 여기서 새로 지어내지 않는다 — comp.html 이 계약과 대조해 어긋나면 죽는다.
 *
 * ★시선 규칙(◆지시 ⑥⑦) — 자세한 근거는 기획-시선흐름·컴프3안.md §3
 *   R1 차가운 진입은 좌상>우상>좌하>우하  (실제 발동 = C0 카피 · C9 코드 헤더 2곳뿐)
 *   R2 컴프 k+1 진입 앵커 = 컴프 k 종점 (≤320px)      ← G8 게이트가 잰다
 *   R3 한 막 안에서 시선 이동은 단조. 예외 = 수렴(C4·C8) · 정지 이벤트(C5·C6)
 *   R4 오브젝트 계승은 선택. 물려주는 것은 위치와 운동 방향
 *   R5 R1 을 막마다 되풀이하지 않는다
 */
(function (global) {
  'use strict';

  const W = 1080, H = 1920, FPS = 25;
  const TOTAL_F = 750, BPM = 120, BARS = 15;
  const BAR_F = 50, BEAT_F = 12.5;

  // 세이프존 — 의미층(글자·핵심) / 증거층(자막·라벨)
  const SAFE = { x0: 108, y0: 154, x1: 886, y1: 1536 };
  const EVID = { x0: 40, y0: 100, x1: 1040, y1: 1700 };
  const SUB_Y = 1566;                 // 워드싱크 자막 밴드 중심(증거층)

  const PAL = {
    bg:   '#05060a',
    ink:  '#f2f5ff',
    dim:  'rgba(242,245,255,0.55)',
    faint:'rgba(242,245,255,0.22)',
    acc:  '#ffb45a',                  // 강착원반 주황
    hot:  '#fff3d8',
    blue: '#7fd8ff',                  // 다가오는 쪽 · UI
    red:  '#ff6b5a',                  // 멀어지는 쪽
    panel:'rgba(6,8,14,0.86)',
  };

  // ── 컴프 표 ────────────────────────────────────────────────────────────────
  //  len 은 50f(2.0s) 또는 75f(3.0s) 뿐 — ◆지시 ② 「2~3초」의 정수해
  //  enter/exit = 시선 진입 앵커 / 종점(px)
  //  pEnd = 주 애니메이션이 완결되는 프레임(컴프 내 상대). G7 이 len-pEnd ≥ 10f 를 요구한다
  const COMP = [
    { i:0,  f0:0,   len:50, act:1, key:'HOOK',   nar:'N0', enter:[300,430],  exit:[540,706],  pEnd:34 },
    { i:1,  f0:50,  len:75, act:1, key:'RAYFAN', nar:'N1', enter:[540,706],  exit:[790,470],  pEnd:58 },
    { i:2,  f0:125, len:50, act:1, key:'ONERAY', nar:null, enter:[790,470],  exit:[300,1330], pEnd:36 },
    { i:3,  f0:175, len:75, act:2, key:'ARCH',   nar:'N2', enter:[300,1330], exit:[830,1080], pEnd:58 },
    { i:4,  f0:250, len:50, act:2, key:'RING',   nar:null, enter:[830,1080], exit:[540,960],  pEnd:36 },
    { i:5,  f0:300, len:75, act:2, key:'INFALL', nar:'N3', enter:[540,960],  exit:[540,960],  pEnd:60 },
    { i:6,  f0:375, len:75, act:2, key:'MERGE',  nar:null, enter:[540,960],  exit:[540,960],  pEnd:58 },
    { i:7,  f0:450, len:50, act:3, key:'DOPPLER',nar:'N4', enter:[540,960],  exit:[790,1000], pEnd:36 },
    { i:8,  f0:500, len:75, act:3, key:'MONEY',  nar:null, enter:[790,1000], exit:[540,960],  pEnd:60 },
    { i:9,  f0:575, len:50, act:4, key:'CODE',   nar:null, enter:[540,960],  exit:[340,560],  pEnd:36 },
    { i:10, f0:625, len:50, act:4, key:'TIMELINE',nar:'N5',enter:[340,560],  exit:[800,650],  pEnd:36 },
    { i:11, f0:675, len:75, act:4, key:'CTA',    nar:null, enter:[800,650],  exit:[620,1250], pEnd:56 },
  ];

  // ── 카메라 — 컴프별 렌징 파라미터(순수함수 f → uniform) ─────────────────────
  // az 는 전 구간 **단조 증가**(되감기 0). zoom 은 컴프별로만 바뀐다.
  const D2R = Math.PI / 180;
  function lensParams(f) {
    const t = f / FPS;
    const az = t * 0.043;                       // 전 구간 단조 = 물리 되감기 없음
    let zoom = 1.14, expo = 1.0, star = 1.0, shake = [0, 0];

    // ★경사각을 막마다 바꾼다 — 같은 블랙홀이 12 컴프 내내 같은 실루엣이면 화면이 반복으로 읽힌다
    //   (컨택트 시트 육안 판정: C0·C4·C7·C8·C11 이 서로 구분이 안 됐다).
    //   막 경계는 어차피 컷이므로 각도 점프가 허용된다. 막 **안에서는** 느리게 흐르기만 한다.
    //     막1·막2(C0~C6)  72° → 75°   기본 시점
    //     막3   (C7~C8)   82°         더 옆에서 = 원반이 얇아지고 좌우 도플러 대비가 커진다
    //     막4   (C9~C11)  70° → 72°   오프닝 각도로 되돌아온다(북엔드)
    //   ⚠62° 까지 열어 봤더니 막4 가 **어두워졌다**(컨택트 시트 실측 — 원반이 화면 밖으로
    //     벌어져 마지막 3초가 검정에 가까워졌다). 리텐션 말미를 스스로 깎는 각도라 기각.
    let incl;
    if (f < 450)      incl = (72 + 3 * Math.min(1, f / 450)) * D2R;
    else if (f < 575) incl = (82 + 1.5 * ((f - 450) / 125)) * D2R;
    else              incl = (70 + 2.0 * ((f - 575) / 175)) * D2R;
    // ★zoom = 카메라 거리 배율(크면 멀다). 1.00 이면 원반이 화면을 넘쳐 「블랙홀」로 안 읽힌다
    //   (실측 f0) — 그림자 반경 = b_crit/(15·zoom·fov)·H 로 zoom 1.14 에서 254px.

    if (f >= 250 && f < 300) {                  // C4 링 점화 — 살짝 당긴다
      zoom = 1.14 - 0.06 * ease('eio', (f - 250) / 50);
    } else if (f >= 300 && f < 375) {           // C5 인폴 — 별 궤도가 다 들어오게 물러선다
      zoom = 1.08 + 0.22 * ease('eo', Math.min(1, (f - 300) / 40));
    } else if (f >= 375 && f < 450) {
      // ★C6 은 **카메라가 한 번 끊고 들어간다**. C5 와 화면이 거의 같아서 f375 경계의
      //   픽셀 차가 5.85(국소 median×4.4)까지 떨어져 G2 에서 「컷이 사라졌다」로 걸렸다.
      //   1.30 → 1.16 계단 = 진짜 컷이고, 리드 스타가 떨어지는 걸 당겨 보는 동작이라 내용과도 맞다.
      zoom = 1.16 - 0.06 * ease('eo', (f - 375) / 75);
    } else if (f >= 450 && f < 500) {           // C7 도플러 — 원반 좌우가 화면 폭을 채우게
      zoom = 1.30 - 0.16 * ease('eio', (f - 450) / 50);
    } else if (f >= 500 && f < 575) {           // C8 머니샷 — 밀어 넣는다
      zoom = 1.14 - 0.20 * ease('eio', (f - 500) / 75);
      expo = 1.0 + 0.14 * ease('eio', (f - 500) / 75);
    } else if (f >= 575) {
      zoom = 0.94; expo = 1.14;
    }

    // C6 합류 셰이크 — 결정론 해시(난수 아님)
    const mf = MERGE_F();
    if (f >= mf && f < mf + 18) {
      const amp = 13.0 * Math.pow(1 - (f - mf) / 18, 2.0);
      shake = global.LensEngine.shakeAt(t, amp);
    }
    return { t, az, zoom, incl, expo, star, shake, form: 1.0, fov: 1.15 };
  }

  // 합류(리드 스타가 원반 안쪽에 닿는) 프레임 — infall 베이크가 정한다.
  // comp.html 이 베이크 후 setMergeFrame() 으로 심는다(수기 값 금지).
  let _mergeF = 425;
  function MERGE_F() { return _mergeF; }
  function setMergeFrame(f) { _mergeF = f; }

  // ── 이징 — gsap.parseEase 순수평가(손코딩 0) ───────────────────────────────
  const _ec = {};
  function ease(name, x) {
    const key = { eo: 'power2.out', ei: 'power2.in', eio: 'power2.inOut',
                  eo3: 'power3.out', back: 'back.out(1.7)', exp: 'expo.out',
                  circ: 'circ.out', lin: 'none' }[name] || name;
    if (!_ec[key]) _ec[key] = global.gsap.parseEase(key);
    return _ec[key](Math.max(0, Math.min(1, x)));
  }

  // amount 모드 stagger — 뱅크 부록A
  function stagger(i, n, amount) { return n <= 1 ? 0 : (amount * i) / (n - 1); }

  function compAt(f) {
    for (let k = COMP.length - 1; k >= 0; k--) if (f >= COMP[k].f0) return COMP[k];
    return COMP[0];
  }

  /** ★G7 — 컴프 주 애니메이션 진행도. 1.0 도달 후 컴프 끝까지 유지돼야 한다. */
  function progress(f) {
    const c = compAt(f);
    return Math.max(0, Math.min(1, (f - c.f0) / c.pEnd));
  }

  global.BEATS = {
    W, H, FPS, TOTAL_F, BPM, BARS, BAR_F, BEAT_F,
    SAFE, EVID, SUB_Y, PAL, COMP,
    lensParams, ease, stagger, compAt, progress, MERGE_F, setMergeFrame,
  };
})(typeof window !== 'undefined' ? window : globalThis);
