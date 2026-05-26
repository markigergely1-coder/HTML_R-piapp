/**
 * volleyball3d.ts — Procedurális Three.js röplabda a hero kártyán.
 * Lazy importálva (nem blokkolja az oldal betöltését).
 *
 * Nem kell GLB fájl: a labda geometriáját és mintázatát programozottan
 * generáljuk Three.js-sel.
 */

import * as THREE from 'three';

interface VBallInstance {
  destroy: () => void;
}

let activeInstance: VBallInstance | null = null;

/**
 * Elindítja a 3D röplabda animációt a megadott canvas-ben.
 * Ha már fut egy, előbb leállítja azt.
 */
export function mountVolleyball(canvas: HTMLCanvasElement, isDark: boolean): VBallInstance {
  // Előző instance tisztítása
  if (activeInstance) {
    activeInstance.destroy();
    activeInstance = null;
  }

  // ── Renderer ──
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  renderer.setClearColor(0x000000, 0); // átlátszó háttér

  // ── Scene ──
  const scene = new THREE.Scene();

  // ── Camera ──
  const camera = new THREE.PerspectiveCamera(
    45,
    canvas.clientWidth / canvas.clientHeight,
    0.1,
    100,
  );
  camera.position.set(0, 0, 3.2);

  // ── Röplabda gömb ──
  const geo = new THREE.SphereGeometry(1, 64, 64);

  // Alap labda szín (accent-hez illő, de nem copy-paste — saját paletta)
  const ballColor = isDark ? 0xd4a854 : 0xe8b96a;      // meleg arany
  const lineColor = isDark ? 0x1a1510 : 0x3d2e1a;       // sötét barna vonalak
  const panelColor = isDark ? 0xc49040 : 0xdaa550;      // árnyékolás a panelokon

  // ── Egyedi shader material (labda minta) ──
  // A röplabda karakterisztikus 3 ívelt csíkját shader-rel rajzoljuk.
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uBallColor:  { value: new THREE.Color(ballColor)  },
      uLineColor:  { value: new THREE.Color(lineColor)  },
      uPanelColor: { value: new THREE.Color(panelColor) },
      uLineWidth:  { value: 0.04 },
      uTime:       { value: 0 },
    },
    vertexShader: /* glsl */`
      varying vec3 vNormal;
      varying vec3 vPosition;
      void main() {
        vNormal   = normalize(normalMatrix * normal);
        vPosition = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform vec3  uBallColor;
      uniform vec3  uLineColor;
      uniform vec3  uPanelColor;
      uniform float uLineWidth;
      varying vec3  vNormal;
      varying vec3  vPosition;

      // Soft step a vonalakhoz
      float lineAt(float v, float w) {
        return smoothstep(w, w * 0.3, abs(v));
      }

      // Röplabda karakterisztikus ívek (gömb felszíni koordinátákkal)
      float volleyballLines(vec3 p) {
        // 3 nagy ív — X, Y, Z síkban forgott
        float line1 = lineAt(p.y,                      uLineWidth);
        float line2 = lineAt(p.x * 0.87 + p.y * 0.5,  uLineWidth);
        float line3 = lineAt(p.x * 0.87 - p.y * 0.5,  uLineWidth);
        // Kisebb kereszt-vonalak a sarkokban
        float cross1 = lineAt(p.z,                     uLineWidth * 0.8);
        return max(max(line1, line2), max(line3, cross1));
      }

      void main() {
        vec3 p = normalize(vPosition);

        // Diffúz megvilágítás — fix irányból
        vec3 lightDir = normalize(vec3(1.2, 1.8, 2.0));
        float diff = max(dot(vNormal, lightDir), 0.0);
        float ambient = 0.35;
        float light = ambient + diff * 0.65;

        // Alap labda szín árnyalással
        vec3 baseColor = mix(uPanelColor, uBallColor, smoothstep(0.2, 0.9, light));

        // Röplabda vonalak felülírják a színt
        float lines = volleyballLines(p);
        vec3 color = mix(baseColor, uLineColor, lines);

        // Enyhe fresnel (perem sötétedés — 3D hatás)
        float fresnel = pow(1.0 - max(dot(vNormal, vec3(0.0, 0.0, 1.0)), 0.0), 2.5);
        color = mix(color, color * 0.55, fresnel * 0.4);

        // Spekuláris highlight
        vec3 viewDir  = vec3(0.0, 0.0, 1.0);
        vec3 halfDir  = normalize(lightDir + viewDir);
        float spec    = pow(max(dot(vNormal, halfDir), 0.0), 32.0);
        color += vec3(1.0) * spec * 0.25 * (1.0 - lines);

        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });

  const ball = new THREE.Mesh(geo, material);
  scene.add(ball);

  // ── Gyenge ambient fény (spekuláris kiegészítés) ──
  const ambLight = new THREE.AmbientLight(0xffffff, 0.2);
  scene.add(ambLight);

  // ── Animáció ──
  let rafId: number;
  let startTime = performance.now();
  let destroyed = false;

  // Lassú, folyamatos forgás — nem idegesítő
  const ROTATION_SPEED_X = 0.003;
  const ROTATION_SPEED_Y = 0.007;

  // Enyhe "lélegzés" skálázás
  const BREATHE_AMPLITUDE = 0.018;
  const BREATHE_SPEED = 0.0007;

  const animate = () => {
    if (destroyed) return;
    rafId = requestAnimationFrame(animate);

    const elapsed = (performance.now() - startTime) * 0.001;

    // Shader idő (jelenleg nem használt, de bővíthetőséghez hasznos)
    (material.uniforms.uTime as THREE.IUniform<number>).value = elapsed;

    // Forgás
    ball.rotation.x += ROTATION_SPEED_X;
    ball.rotation.y += ROTATION_SPEED_Y;

    // Lélegzés
    const breathe = 1 + Math.sin(elapsed * BREATHE_SPEED * 2 * Math.PI * 100) * BREATHE_AMPLITUDE;
    ball.scale.setScalar(breathe);

    renderer.render(scene, camera);
  };

  animate();

  // ── Resize ──
  const resizeObserver = new ResizeObserver(() => {
    if (destroyed) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  });
  resizeObserver.observe(canvas);

  const instance: VBallInstance = {
    destroy() {
      destroyed = true;
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      renderer.dispose();
      geo.dispose();
      material.dispose();
      activeInstance = null;
    },
  };

  activeInstance = instance;
  return instance;
}

/**
 * Leállítja az aktív 3D instance-t (oldalváltáskor hívd meg).
 */
export function destroyVolleyball(): void {
  if (activeInstance) {
    activeInstance.destroy();
    activeInstance = null;
  }
}
