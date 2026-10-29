// =============================================================================
// SCENE - renderer, camera rig, ball visuals, trail, ambient dust, bloom
// =============================================================================
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { TrackView } from './trackview.js';
import { themeAt } from './theme.js';
import { BALL_R, V_MAX } from './config.js';

const WHITE = new THREE.Color(0xffffff);
const TRAIL_N = 26;
const DUST_N = 380;

function radialTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

/** Faint latitude bands so you can see the ball roll. */
function ballTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#f4f6ff';
  g.fillRect(0, 0, 256, 128);
  g.fillStyle = 'rgba(120,130,170,0.35)';
  for (let i = 0; i < 8; i++) g.fillRect(i * 32, 0, 6, 128);
  g.fillStyle = 'rgba(120,130,170,0.25)';
  g.fillRect(0, 60, 256, 8);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class GameScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0418);
    this.scene.fog = new THREE.Fog(0x0a0418, 40, 250);

    this.camera = new THREE.PerspectiveCamera(70, 1, 0.1, 400);
    this.baseFov = 70;

    this.track = new TrackView(this.scene);

    // ---- ball -----------------------------------------------------------
    this.ball = new THREE.Group();
    this.scene.add(this.ball);
    this.ballMesh = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_R, 32, 24),
      new THREE.MeshStandardMaterial({
        map: ballTexture(), emissive: 0x666a80, roughness: 0.4, metalness: 0,
      }),
    );
    this.ball.add(this.ballMesh);
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: radialTexture(), color: 0x39ffb0, transparent: true, opacity: 0.3,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.glow.scale.setScalar(3.4);
    this.ball.add(this.glow);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const sun = new THREE.DirectionalLight(0xffffff, 2.4);
    sun.position.set(4, 9, 6);
    this.scene.add(sun);

    // ---- trail ----------------------------------------------------------
    this.trailPos = new Float32Array(TRAIL_N * 3);
    const sizes = new Float32Array(TRAIL_N), alphas = new Float32Array(TRAIL_N);
    for (let i = 0; i < TRAIL_N; i++) {
      const k = 1 - i / TRAIL_N;
      sizes[i] = 0.15 + 0.85 * k;
      alphas[i] = 0.5 * k * k;
    }
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3));
    tg.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    tg.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
    this.trailMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0x39ffb0) }, uScale: { value: 600 } },
      vertexShader: `
        attribute float aSize; attribute float aAlpha; uniform float uScale; varying float vA;
        void main(){ vA = aAlpha; vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = aSize * uScale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `
        uniform vec3 uColor; varying float vA;
        void main(){ float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d) * vA; gl_FragColor = vec4(uColor, a); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.trail = new THREE.Points(tg, this.trailMat);
    this.trail.frustumCulled = false;
    this.scene.add(this.trail);

    // ---- ambient dust (gives a sense of speed in the void) ----------------
    this.dustPos = new Float32Array(DUST_N * 3);
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(this.dustPos, 3));
    this.dustMat = new THREE.PointsMaterial({
      color: 0x8888ff, size: 0.18, transparent: true, opacity: 0.55, depthWrite: false,
    });
    this.dust = new THREE.Points(dg, this.dustMat);
    this.dust.frustumCulled = false;
    this.scene.add(this.dust);

    // ---- camera rig state -------------------------------------------------
    this.camPos = new THREE.Vector3();
    this.camLook = new THREE.Vector3();
    this.shakeAmp = 0;
    this.roll = 0;
    this.q = new THREE.Quaternion();
    this.tmpV = new THREE.Vector3();
    this.tmpAxis = new THREE.Vector3();

    // ---- post: bloom, auto-disabled if the device can't hold framerate -----
    this.useBloom = true;
    this.slowFrames = 0;
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.4, 0.3);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 150));
    this.setScore(0);
  }

  // ---- sizing ---------------------------------------------------------------
  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.w = w; this.h = h;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w / 2, h / 2);
    this.camera.aspect = w / h;
    // portrait phones need a wider vertical FOV to keep the track in view
    this.baseFov = this.camera.aspect < 1 ? 88 : 70;
    this.camera.fov = this.baseFov;
    this.camera.updateProjectionMatrix();
  }

  // ---- theme ----------------------------------------------------------------
  setScore(score) {
    const c = themeAt(score);
    this.scene.background.copy(c.fog);
    this.scene.fog.color.copy(c.fog);
    this.track.setTheme(c);
    this.glow.material.color.copy(c.glow);
    this.trailMat.uniforms.uColor.value.copy(c.glow);
    this.dustMat.color.copy(c.edge).lerp(WHITE, 0.4);
  }

  // ---- ball -----------------------------------------------------------------
  resetBall(b) {
    this.ball.position.set(b.x, b.y, b.z);
    this.ballMesh.quaternion.identity();
    for (let i = 0; i < TRAIL_N; i++) {
      this.trailPos[i * 3] = b.x; this.trailPos[i * 3 + 1] = b.y; this.trailPos[i * 3 + 2] = b.z;
    }
    this.trail.geometry.attributes.position.needsUpdate = true;
    this.resetCamera(b);
    this._seedDust(b);
  }

  updateBall(b, dt, alive) {
    this.ball.position.set(b.x, b.y, b.z);
    // roll: rotate about (up x velocity)
    const sp = Math.hypot(b.vx, b.vy, b.vz);
    if (sp > 0.01) {
      // up(0,1,0) x v(vx,vy,vz) = (vz, 0, -vx)
      this.tmpAxis.set(b.vz, 0, -b.vx).normalize();
      const ang = (sp * dt) / BALL_R * (alive ? 1 : 0.8);
      this.q.setFromAxisAngle(this.tmpAxis, ang);
      this.ballMesh.quaternion.premultiply(this.q);
    }
    // shift trail history
    const p = this.trailPos;
    p.copyWithin(3, 0, (TRAIL_N - 1) * 3);
    p[0] = b.x; p[1] = b.y; p[2] = b.z;
    this.trail.geometry.attributes.position.needsUpdate = true;
  }

  // ---- camera ---------------------------------------------------------------
  resetCamera(b) {
    this.camPos.set(b.x, b.y + 4, b.z + 8.5);
    this.camLook.set(b.x, b.y - 2.5, b.z - 12);
    this.shakeAmp = 0;
  }

  shake(amount) { this.shakeAmp = Math.max(this.shakeAmp, amount); }

  /** Third-person follow camera with a little lag. */
  updateCamera(b, dt, speed, follow = true) {
    const kx = 1 - Math.exp(-dt * 4.5);
    const ky = 1 - Math.exp(-dt * (follow ? 5 : 1.2));
    const kz = 1 - Math.exp(-dt * 8);
    this.camPos.x += (b.x * 0.92 - this.camPos.x) * kx;
    this.camPos.y += (b.y + 4 - this.camPos.y) * ky;
    this.camPos.z += (b.z + 8.5 - this.camPos.z) * kz;
    this.camLook.x += (b.x - this.camLook.x) * (1 - Math.exp(-dt * 6));
    this.camLook.y += (b.y - 2.6 - this.camLook.y) * ky;
    this.camLook.z += (b.z - 12 - this.camLook.z) * kz;

    this.shakeAmp *= Math.exp(-dt * 4.5);
    const sa = this.shakeAmp;
    this.tmpV.copy(this.camPos);
    if (sa > 0.003) {
      this.tmpV.x += (Math.random() - 0.5) * sa;
      this.tmpV.y += (Math.random() - 0.5) * sa;
      this.tmpV.z += (Math.random() - 0.5) * sa * 0.5;
    }
    this.camera.position.copy(this.tmpV);
    this.camera.lookAt(this.camLook);
    // tiny roll into the turn
    const targetRoll = -b.vx * 0.0035;
    this.roll += (targetRoll - this.roll) * (1 - Math.exp(-dt * 6));
    this.camera.rotateZ(this.roll);
    // speed -> wider FOV
    const fov = this.baseFov + (speed / V_MAX) * 10;
    if (Math.abs(fov - this.camera.fov) > 0.05) {
      this.camera.fov += (fov - this.camera.fov) * (1 - Math.exp(-dt * 3));
      this.camera.updateProjectionMatrix();
    }
  }

  // ---- dust -----------------------------------------------------------------
  _seedDust(b) {
    for (let i = 0; i < DUST_N; i++) this._placeDust(i, b, true);
    this.dust.geometry.attributes.position.needsUpdate = true;
  }
  _placeDust(i, b, anywhere) {
    const p = this.dustPos;
    p[i * 3] = b.x + (Math.random() - 0.5) * 90;
    p[i * 3 + 1] = b.y + (Math.random() - 0.3) * 50;
    p[i * 3 + 2] = anywhere ? b.z + 20 - Math.random() * 200 : b.z - 190 - Math.random() * 20;
  }
  updateDust(b) {
    const p = this.dustPos;
    for (let i = 0; i < DUST_N; i++) {
      if (p[i * 3 + 2] > b.z + 22 || Math.abs(p[i * 3] - b.x) > 50 || Math.abs(p[i * 3 + 1] - b.y) > 40) {
        this._placeDust(i, b, false);
      }
    }
    this.dust.geometry.attributes.position.needsUpdate = true;
  }

  // ---- frame ----------------------------------------------------------------
  render(frameMs) {
    this.trailMat.uniforms.uScale.value =
      this.renderer.domElement.height / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
    // drop bloom on slow devices
    if (this.useBloom) {
      this.slowFrames = frameMs > 26 ? this.slowFrames + 1 : Math.max(0, this.slowFrames - 2);
      if (this.slowFrames > 90) this.useBloom = false;
    }
    if (this.useBloom) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
