// 렌더 브라우저 기동 — render.mjs · render_thumb.mjs · hold_gate.mjs 공용.
// ★한 거처에 둔 이유: 세 파일에 같은 후보 목록을 복사해 두면 한 곳만 고쳐져 조용히 갈린다
//   (실제로 render_thumb 에서 Edge 가 빠져 기동 실패했다).
import { pathToFileURL, fileURLToPath } from 'url';
import path from 'path'; import fs from 'fs';

// 작업 트리 안이면 센티넬을 찾고, 밖(=공개 저장소)이면 null 을 준다.
export function findRoot(start){
  let d = start;
  for(;;){
    if (fs.existsSync(path.join(d, '.akashic-root'))) return d;
    const up = path.dirname(d);
    if (up === d) return null;
    d = up;
  }
}

// ★래스터 결정론 플래그(ep14 실측 — DOM+CSS 는 실행마다 래스터 경로가 달라진다).
//   이 편은 캔버스 단독이지만 비용이 0 이므로 같은 세트를 건다.
export const FLAGS = ['--disable-lcd-text','--disable-font-subpixel-positioning',
  '--force-color-profile=srgb','--disable-partial-raster','--disable-skia-runtime-opts',
  '--disable-gpu-rasterization','--disable-features=DefaultPassthroughCommandDecoder'];

// ★★WebGL 셰이더는 **실 GPU 에서 픽셀 SHA 결정론을 만족하지 않는다**(이 편 실측).
//   RTX 3060 / ANGLE D3D11 로 같은 프레임을 정순·역순에 찍으면 max Δ 4~8/255 가
//   수백 픽셀에 흩어져 나왔다(f300 615px · f537 934px). 시크 순서에 따라 값이 갈리므로
//   「같은 코드 → 같은 프레임」이라는 재현 패키지의 약속이 GPU 경로에서는 성립하지 않는다.
//   ⇒ **납품 렌더와 게이트는 SwiftShader(소프트웨어 래스터)로 돌린다.** 0.23s → 5.4s/frame
//      이지만 결정론이 성립한다. 반복 작업(스팟 확인)만 GPU 로 빠르게 돈다.
//   전환 = 환경변수 `DET_SW=1` (기본값 = SwiftShader. GPU 는 `DET_SW=0`).
export const SW_FLAGS = ['--use-gl=angle', '--use-angle=swiftshader', '--disable-gpu'];

const SYSTEM = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];

// ★공개 저장소로 클론한 경우엔 센티넬이 없다 → 평범하게 `playwright` 를 import 한다
//   (README 의 `npm i playwright` 가 그 경로다). 작업 트리 안에서는 공유 venv 옆의
//   site-factory node_modules 를 쓴다 — 이 편만 따로 설치하지 않기 위해서다.
export async function launch(here){
  const ROOT = findRoot(here);
  let pw;
  if (ROOT) {
    const SF = path.join(ROOT, 'projects', 'site-factory');
    pw = await import(pathToFileURL(path.join(SF, 'node_modules', 'playwright', 'index.js')).href);
  } else {
    pw = await import('playwright');
  }
  const { chromium } = pw.default ?? pw;
  const sw = process.env.DET_SW !== '0';
  const args = sw ? FLAGS.concat(SW_FLAGS) : FLAGS;
  console.log(sw ? '래스터 = SwiftShader (결정론 경로)' : '래스터 = GPU (빠름 · 결정론 미보장)');
  try {
    return await chromium.launch({ args });             // 번들 chromium 우선
  } catch (e) {
    const executablePath = SYSTEM.find(c => fs.existsSync(c));
    if (!executablePath) throw e;
    console.log('번들 chromium 기동 실패 → 시스템 브라우저 사용');
    return await chromium.launch({ executablePath, args });
  }
}

export const here = url => path.dirname(fileURLToPath(url));
