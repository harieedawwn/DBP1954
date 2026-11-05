/* realism.js — physically based look for the whole game.
 * - Converts Lambert/Phong materials to MeshStandardMaterial (roughness/metalness by surface),
 *   reuses each color map as a bump map so every surface gets relief under the light.
 * - Image-based lighting from a dusty afternoon sky (PMREM) so materials sit in the scene.
 * - Post chain: world -> weapon -> tone map (ACES) -> war-film grade (desaturation, warm dust,
 *   soft contrast, vignette, fine grain). No bloom, no neon: a documentary look.
 * API: G.Realism.prepareWorld(scene, renderer), prepareView(viewScene, renderer), upgrade(root),
 *      createComposer(renderer, quality) -> {render(scene, camera, viewScene, viewCamera, dt), setSize(w,h)}
 */
window.G = window.G || {};
(function () {
  'use strict';
  const T = THREE;
  const A = window.THREE_ADDONS || {};
  const converted = new Map();   // original material uuid -> standard material
  let envTex = null;

  // ------------------------------------------------------------------ materials
  function guessSurface(mesh, mat) {
    const s = mesh.userData && mesh.userData.surface;
    if (s) return s;
    const n = (mat.name || '') + ' ' + (mesh.name || '');
    if (/metal|steel|tank|corrug|wire|mag|jacket/i.test(n)) return 'metal';
    return '';
  }

  function convert(mat, mesh, kind) {
    if (!mat || mat.isMeshStandardMaterial || mat.isShaderMaterial || mat.isMeshBasicMaterial ||
        mat.isSpriteMaterial || mat.isPointsMaterial || mat.isLineBasicMaterial) return mat;
    if (!(mat.isMeshLambertMaterial || mat.isMeshPhongMaterial)) return mat;
    const key = mat.uuid + kind;
    if (converted.has(key)) return converted.get(key);

    const surface = guessSurface(mesh, mat);
    const phong = mat.isMeshPhongMaterial;
    const shiny = phong ? Math.min(1, (mat.shininess || 30) / 80) : 0;
    let rough = 0.93, metal = 0.0, bump = 1.0;
    if (surface === 'metal') { rough = 0.62; metal = 0.55; bump = 0.9; }
    else if (surface === 'wood') { rough = 0.86; bump = 1.7; }
    else if (surface === 'sandbag') { rough = 0.97; bump = 0.9; }
    if (phong) {                                   // weapon parts, brass
      const spec = mat.specular ? (mat.specular.r + mat.specular.g + mat.specular.b) / 3 : 0;
      metal = spec > 0.2 ? 0.85 : spec > 0.1 ? 0.35 : 0.0;
      rough = 0.78 - shiny * 0.4;
      bump = 0.5;
    }
    if (kind === 'view') bump *= 0.45;
    if (kind === 'char') { rough = 0.95; bump = 0.8; }

    const m = new T.MeshStandardMaterial({
      name: mat.name, color: mat.color ? mat.color.clone() : 0xffffff, map: mat.map || null,
      vertexColors: mat.vertexColors, side: mat.side, transparent: mat.transparent, opacity: mat.opacity,
      alphaTest: mat.alphaTest, flatShading: !!mat.flatShading, fog: mat.fog !== false,
      roughness: rough, metalness: metal, envMapIntensity: kind === 'view' ? 0.9 : 0.55,
      depthWrite: mat.depthWrite, depthTest: mat.depthTest
    });
    if (mat.emissive) m.emissive.copy(mat.emissive);
    if (mat.emissiveMap) m.emissiveMap = mat.emissiveMap;
    if (mat.alphaMap) m.alphaMap = mat.alphaMap;
    if (mat.map && mat.alphaTest === 0) { m.bumpMap = mat.map; m.bumpScale = bump; }
    m.polygonOffset = mat.polygonOffset; m.polygonOffsetFactor = mat.polygonOffsetFactor; m.polygonOffsetUnits = mat.polygonOffsetUnits;
    m.userData.fromRealism = true;
    converted.set(key, m);
    return m;
  }

  function upgrade(root, kind) {
    if (!root) return;
    root.traverse(o => {
      if (!o.isMesh || !o.material) return;
      const k = kind || (o.isSkinnedMesh ? 'char' : 'world');
      if (Array.isArray(o.material)) o.material = o.material.map(x => convert(x, o, k));
      else o.material = convert(o.material, o, k);
    });
  }

  // ------------------------------------------------------------------ environment light
  function buildEnv(renderer) {
    if (envTex) return envTex;
    const sc = new T.Scene();
    const mat = new T.ShaderMaterial({
      side: T.BackSide, depthWrite: false,
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: [
        'varying vec3 vD;',
        'void main(){',
        ' float h = vD.y;',
        ' vec3 zenith = vec3(0.42,0.52,0.66);',
        ' vec3 horizon = vec3(0.86,0.78,0.64);',   // dusty, smoke-filled haze
        ' vec3 ground = vec3(0.36,0.22,0.13);',    // laterite bounce
        ' vec3 c = h > 0.0 ? mix(horizon, zenith, pow(h, 0.55)) : mix(horizon*0.8, ground, pow(-h, 0.4));',
        ' vec3 sd = normalize(vec3(0.55,0.62,0.35));',
        ' float s = max(dot(normalize(vD), sd), 0.0);',
        ' c += vec3(1.0,0.86,0.62) * (pow(s, 64.0)*6.0 + pow(s, 6.0)*0.35);',
        ' gl_FragColor = vec4(c, 1.0);',
        '}'].join('\n')
    });
    sc.add(new T.Mesh(new T.SphereGeometry(10, 32, 16), mat));
    const pm = new T.PMREMGenerator(renderer);
    envTex = pm.fromScene(sc, 0.02).texture;
    pm.dispose();
    return envTex;
  }

  function prepareWorld(scene, renderer) {
    if (renderer) scene.environment = buildEnv(renderer);
    scene.traverse(o => { if (o.isHemisphereLight) o.intensity *= 0.62; if (o.isDirectionalLight) o.intensity *= 1.08; });
    upgrade(scene, 'world');
  }

  function prepareView(viewScene, renderer) {
    if (renderer) viewScene.environment = buildEnv(renderer);
    viewScene.traverse(o => { if (o.isHemisphereLight) o.intensity *= 0.55; });
    upgrade(viewScene, 'view');
  }

  // ------------------------------------------------------------------ post processing
  const GradeShader = {
    uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uRes: { value: new T.Vector2(1, 1) }, uHurt: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: [
      'uniform sampler2D tDiffuse; uniform float uTime; uniform vec2 uRes; uniform float uHurt; varying vec2 vUv;',
      'float hash(vec2 p){ p = fract(p*vec2(443.897,441.423)); p += dot(p, p.yx+19.19); return fract((p.x+p.y)*p.x); }',
      'void main(){',
      ' vec3 c = texture2D(tDiffuse, vUv).rgb;',          // display-referred (after ACES + sRGB)
      ' float l = dot(c, vec3(0.299,0.587,0.114));',
      ' c = mix(vec3(l), c, 0.70 - uHurt*0.35);',          // muted, war-film palette
      ' c *= vec3(1.03, 1.0, 0.92);',                       // warm dust
      ' c = mix(c, c*c*(3.0-2.0*c), 0.22);',                // gentle S-curve
      ' c = c*0.96 + vec3(0.025,0.022,0.015);',             // lifted, hazy blacks
      ' vec2 q = vUv - 0.5; q.x *= uRes.x/uRes.y;',
      ' c *= mix(1.0, smoothstep(0.95, 0.25, length(q)), 0.38);',  // lens vignette
      ' float g = hash(vUv*uRes + fract(uTime*7.13)*97.0) - 0.5;',
      ' c += g * 0.028 * (1.0 - l*0.6);',                   // fine film grain, stronger in shadows
      ' gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);',
      '}'].join('\n')
  };

  function createComposer(renderer) {
    if (!A.EffectComposer) return null;
    const size = renderer.getSize(new T.Vector2());
    const pr = renderer.getPixelRatio();
    const rt = new T.WebGLRenderTarget(size.x * pr, size.y * pr, { type: T.HalfFloatType, samples: renderer.capabilities.isWebGL2 ? 4 : 0 });
    const composer = new A.EffectComposer(renderer, rt);
    const worldPass = new A.RenderPass(new T.Scene(), new T.PerspectiveCamera());
    const viewPass = new A.RenderPass(new T.Scene(), new T.PerspectiveCamera());
    viewPass.clear = false; viewPass.clearDepth = true;
    const out = new A.OutputPass();
    const grade = new A.ShaderPass(GradeShader);
    composer.addPass(worldPass); composer.addPass(viewPass); composer.addPass(out); composer.addPass(grade);
    let t = 0;
    return {
      composer, grade,
      setSize(w, h) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, h); grade.uniforms.uRes.value.set(w, h); },
      render(scene, camera, viewScene, viewCamera, dt, hurt) {
        t += dt || 0.016;
        worldPass.scene = scene; worldPass.camera = camera;
        viewPass.enabled = !!(viewScene && viewCamera);
        if (viewPass.enabled) { viewPass.scene = viewScene; viewPass.camera = viewCamera; }
        grade.uniforms.uTime.value = t;
        grade.uniforms.uHurt.value = hurt || 0;
        composer.render(dt);
      }
    };
  }

  if (/[?&]noreal\b/.test(location.search)) return;   // debug: original materials, no post
  G.Realism = { prepareWorld, prepareView, upgrade, createComposer, buildEnv };
})();
