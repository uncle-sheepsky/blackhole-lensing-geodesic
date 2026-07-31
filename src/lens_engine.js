/* lens_engine.js — 슈바르츠실트 블랙홀 중력렌징 (WebGL2, seek-safe 순수함수)
 *
 * 구 ep4_blackhole/lens_proto.html 승계. 이 편에서 확장한 것:
 *   · 카메라 파라미터(incl·az·fov·zoom)를 호출자가 준다(프로토는 u_t 에 묶여 있었다)
 *   · 노출(expo)·원반 안쪽 반경(diskIn)·별필드 밝기(starGain)를 컴프별로 뺀다
 *   · 셰이더 상수 RS/DISK_IN/DISK_OUT/STEPS/DT 를 JS 로 노출 = geodesic.js 와 같은 값을 쓴다
 *
 * ★결정론: 출력 = f(uniform) 순수함수. 시간 진행은 호출자가 t 로만 준다.
 *   rAF·Date.now·Math.random 없음. 같은 인자 → 같은 픽셀.
 *
 * ★물리: 광자 측지선을 카메라에서 거꾸로 적분한다(backward ray tracing).
 *   d²u/dφ² + u = 3M u²  의 데카르트 등가형 —  acc = -1.5 · h² · pos / r⁵
 *   (h = |pos × vel| = 각운동량). 적도면(y=0)을 지날 때마다 강착원반 방출을 누적하므로
 *   한 광선이 원반을 여러 번 만난다 = 2차상(블랙홀 위·아래로 감긴 아치).
 */
(function (global) {
  'use strict';

  // ★geodesic.js 와 공유하는 물리 상수 — 두 구현이 같은 값을 쓴다는 것이 이 편의 정직 조건
  const RS = 1.0;          // 슈바르츠실트 반경(단위)
  const DISK_IN = 2.4;     // 강착원반 안쪽
  const DISK_OUT = 10.0;   // 강착원반 바깥
  const STEPS = 320;       // 적분 스텝 수
  const DT = 0.14;         // 적분 스텝 크기

  const VS = `#version 300 es
in vec2 p; void main(){ gl_Position = vec4(p,0.,1.); }`;

  const FS = `#version 300 es
precision highp float;
out vec4 o;
uniform vec2  u_res;
uniform float u_t;
uniform float u_form;
uniform float u_zoom;
uniform vec2  u_shake;
uniform float u_incl;
uniform float u_az;
uniform float u_fov;
uniform float u_expo;
uniform float u_star;

const float PI = 3.14159265;
const float RS = ${RS.toFixed(1)};
const float DISK_IN  = ${DISK_IN.toFixed(1)};
const float DISK_OUT = ${DISK_OUT.toFixed(1)};
const int   STEPS = ${STEPS};
const float DT = ${DT.toFixed(2)};

float hash21(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
float vnoise(vec2 x){
  vec2 i=floor(x), f=fract(x); f=f*f*(3.0-2.0*f);
  float a=hash21(i), b=hash21(i+vec2(1,0)), c=hash21(i+vec2(0,1)), d=hash21(i+vec2(1,1));
  return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
}
float fbm(vec2 x){ float s=0.0,a=0.5; for(int i=0;i<4;i++){ s+=a*vnoise(x); x*=2.03; a*=0.5;} return s; }

vec3 starField(vec3 dir){
  vec2 uv = vec2(atan(dir.z,dir.x), asin(clamp(dir.y,-1.,1.)));
  vec3 col = vec3(0.0);
  for(float i=0.0;i<3.0;i++){
    float sc = 9.0 + i*13.0;
    vec2 g = uv*sc + i*23.7;
    vec2 cell = floor(g); vec2 f = fract(g)-0.5;
    float h = hash21(cell + i*61.0);
    if(h>0.90){
      vec2 sp = (vec2(hash21(cell+1.3), hash21(cell+2.7))-0.5)*0.7;
      float d = length(f - sp);
      float mag = (h-0.90)/0.10;
      float b = smoothstep(0.06, 0.0, d) * mag;
      float tw = 0.75 + 0.25*sin(u_t*2.0 + h*40.0);
      vec3 tint = mix(vec3(0.65,0.78,1.0), vec3(1.0,0.9,0.72), hash21(cell+5.1));
      col += b*tw*tint*1.3;
    }
  }
  float neb = fbm(uv*2.0)*0.5;
  col += pow(neb,3.0)*vec3(0.10,0.06,0.20);
  return col*u_star;
}

vec3 diskEmission(vec3 xp, float r){
  float tnorm = clamp((DISK_OUT - r)/(DISK_OUT-DISK_IN), 0.0, 1.0);
  vec3 hot  = vec3(1.0, 0.97, 0.90);
  vec3 warm = vec3(1.0, 0.6, 0.2);
  vec3 cool = vec3(0.85, 0.25, 0.35);
  vec3 c = mix(cool, warm, smoothstep(0.0,0.55,tnorm));
  c = mix(c, hot, smoothstep(0.6,1.0,tnorm));
  float ang = atan(xp.z, xp.x);
  float spin = u_t*0.9;
  float arms = fbm(vec2(ang*2.2 + r*0.6 - spin*1.5, r*0.9));
  float dens = 0.55 + 0.9*arms;
  float glow = mix(0.3, 1.8, pow(tnorm,1.3));
  return c*glow*dens;
}

vec3 trace(vec3 cam, vec3 dir){
  vec3 pos = cam, vel = dir;
  vec3 hvec = cross(pos, vel);
  float h2 = dot(hvec, hvec);
  bool captured = false;
  float minR = 1e9;
  vec3 disk = vec3(0.0);
  float rsNow = mix(0.15, RS, smoothstep(0.0,0.5,u_form));
  float diskAmt = smoothstep(0.35,1.0,u_form);
  float diskInNow = mix(DISK_OUT*0.9, DISK_IN, smoothstep(0.4,1.0,u_form));

  for(int i=0;i<STEPS;i++){
    float r2 = dot(pos,pos); float r = sqrt(r2);
    minR = min(minR, r);
    if(r < rsNow){ captured = true; break; }
    vec3 acc = -1.5 * h2 * pos / (r2*r2*r);
    vec3 pPrev = pos;
    vel += acc*DT; pos += vel*DT;
    if(diskAmt>0.001 && pPrev.y*pos.y < 0.0){
      float tc = pPrev.y/(pPrev.y - pos.y);
      vec3 xp = mix(pPrev, pos, tc);
      float rd = length(xp.xz);
      if(rd>diskInNow && rd<DISK_OUT){
        vec3 emis = diskEmission(xp, rd);
        vec3 vdir = normalize(vec3(-xp.z, 0.0, xp.x));
        float beta = clamp(0.46*sqrt(RS/rd), 0.0, 0.72);
        vec3 toCam = normalize(cam - xp);
        float mu = dot(vdir, toCam);
        float gamma = 1.0/sqrt(1.0-beta*beta);
        float dopp = 1.0/(gamma*(1.0 - beta*mu));
        float beam = pow(dopp, 3.0);                     // 상대론 빔잉: 다가오면 밝다
        float grav = sqrt(max(0.0, 1.0 - RS/rd));         // 중력 감쇠: 안쪽일수록 어둡다(색 아님)
        vec3 shift = mix(vec3(1.0,0.55,0.4), vec3(0.6,0.8,1.0), clamp(mu*0.5+0.5,0.0,1.0));
        float edge = smoothstep(DISK_OUT,DISK_OUT-1.5,rd)*smoothstep(diskInNow,diskInNow+0.4,rd);
        disk += emis * beam * grav * shift * edge * diskAmt;
      }
    }
  }
  vec3 col;
  if(captured) col = vec3(0.0);
  else col = starField(normalize(vel));
  col += disk;
  float ring = smoothstep(0.28, 0.0, abs(minR - 1.52*rsNow)) * (captured?0.0:1.0);
  col += ring * vec3(1.0,0.85,0.65) * 1.1 * smoothstep(0.15,0.6,u_form);
  return col;
}

void main(){
  vec2 frag = gl_FragCoord.xy + u_shake;
  vec2 uv = (frag - 0.5*u_res) / u_res.y;
  vec3 cam = 15.0*u_zoom*vec3(sin(u_az)*sin(u_incl), cos(u_incl), cos(u_az)*sin(u_incl));
  vec3 fwd = normalize(-cam);
  vec3 rgt = normalize(cross(vec3(0.,1.,0.), fwd));
  vec3 upv = cross(fwd, rgt);
  vec3 dir = normalize(fwd + u_fov*(uv.x*rgt + uv.y*upv));

  vec3 col = trace(cam, dir) * u_expo;
  col *= 1.0 - 0.35*smoothstep(0.5,1.2,length(uv*vec2(u_res.x/u_res.y,1.0)));
  col *= 1.05;
  vec3 x = col;
  col = clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0);
  col = pow(col, vec3(1.0/2.2));
  o = vec4(col, 1.0);
}`;

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      throw new Error('SHADER: ' + gl.getShaderInfoLog(s));
    return s;
  }

  const DEFAULTS = {
    t: 0, form: 1, zoom: 1, shake: [0, 0],
    incl: 72 * Math.PI / 180, az: 0, fov: 1.15, expo: 1, star: 1,
  };

  function create(canvas) {
    const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false });
    if (!gl) throw new Error('webgl2 없음');
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
      throw new Error('LINK: ' + gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const U = {};
    for (const k of ['res', 't', 'form', 'zoom', 'shake', 'incl', 'az', 'fov', 'expo', 'star'])
      U[k] = gl.getUniformLocation(prog, 'u_' + k);

    return {
      canvas, gl,
      render(o) {
        const p = Object.assign({}, DEFAULTS, o || {});
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.uniform2f(U.res, canvas.width, canvas.height);
        gl.uniform1f(U.t, p.t);
        gl.uniform1f(U.form, p.form);
        gl.uniform1f(U.zoom, p.zoom);
        gl.uniform2f(U.shake, p.shake[0], p.shake[1]);
        gl.uniform1f(U.incl, p.incl);
        gl.uniform1f(U.az, p.az);
        gl.uniform1f(U.fov, p.fov);
        gl.uniform1f(U.expo, p.expo);
        gl.uniform1f(U.star, p.star);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.finish();
      },
    };
  }

  // 결정론 셰이크 — t 의 순수함수(난수 아님)
  function shakeAt(t, amp) {
    if (amp <= 0) return [0, 0];
    return [Math.sin(t * 90) * Math.cos(t * 57) * amp,
            Math.cos(t * 73) * Math.sin(t * 41) * amp];
  }

  // 카메라(셰이더 main() 과 동일 식) — geodesic 투영에 쓴다
  function camera(p) {
    const q = Object.assign({}, DEFAULTS, p || {});
    const R = 15 * q.zoom, si = Math.sin(q.incl), ci = Math.cos(q.incl);
    const cam = [R * Math.sin(q.az) * si, R * ci, R * Math.cos(q.az) * si];
    const n = Math.hypot(cam[0], cam[1], cam[2]);
    const fwd = [-cam[0] / n, -cam[1] / n, -cam[2] / n];
    let rgt = [0 * fwd[2] - 1 * fwd[1], 1 * fwd[0] - 0 * fwd[2], 0 * fwd[1] - 0 * fwd[0]];
    // cross((0,1,0), fwd) = (1*fwd.z - 0*fwd.y, 0*fwd.x - 0*fwd.z, 0*fwd.y - 1*fwd.x)
    rgt = [fwd[2], 0, -fwd[0]];
    const rn = Math.hypot(rgt[0], rgt[1], rgt[2]);
    rgt = [rgt[0] / rn, rgt[1] / rn, rgt[2] / rn];
    const upv = [fwd[1] * rgt[2] - fwd[2] * rgt[1],
                 fwd[2] * rgt[0] - fwd[0] * rgt[2],
                 fwd[0] * rgt[1] - fwd[1] * rgt[0]];
    return { cam, fwd, rgt, upv, fov: q.fov };
  }

  // 월드 좌표 → 캔버스 픽셀(2D 좌표계 = y 아래로 증가)
  function project(world, camObj, W, H) {
    const { cam, fwd, rgt, upv, fov } = camObj;
    const v = [world[0] - cam[0], world[1] - cam[1], world[2] - cam[2]];
    const a = v[0] * fwd[0] + v[1] * fwd[1] + v[2] * fwd[2];
    if (a <= 1e-6) return null;                       // 카메라 뒤
    const x = (v[0] * rgt[0] + v[1] * rgt[1] + v[2] * rgt[2]) / (a * fov);
    const y = (v[0] * upv[0] + v[1] * upv[1] + v[2] * upv[2]) / (a * fov);
    return [x * H + 0.5 * W, 0.5 * H - y * H];        // gl_FragCoord 는 아래가 0 → 뒤집는다
  }

  global.LensEngine = { create, shakeAt, camera, project,
                        RS, DISK_IN, DISK_OUT, STEPS, DT, DEFAULTS };
})(typeof window !== 'undefined' ? window : globalThis);
