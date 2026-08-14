/* ============================================================
   view3d.js — the walkthrough view.

   Extrudes the live 2D plan into a 3D model the client can orbit:
   drape runs rise to their real heights, booths read as colored
   tiles, rented furniture stands at true size. Nothing here is a
   second source of truth — every frame is derived from the same
   elements the 2D editor edits, so the 3D view is always current.

   Three.js is loaded on first open (dynamic import from CDN), so
   sessions that never touch 3D never pay for it.
   ============================================================ */
(function (root) {
  const FP = (root.FP = root.FP || {});

  let THREE = null;
  let Orbit = null;

  let overlay = null;      /* DOM shell */
  let renderer, scene, camera, controls, raf = 0;
  let opened = false;

  /* ---------------- real-world heights, in plan units (ft) ----------------
     Anything not listed falls back by shape: rect -> low tile, line -> wall,
     marker -> stub. Heights are what a fitter would build, not guesses. */
  const HEIGHTS = {
    wall: 12, column: 24, stairs: 3, 'loading-dock': 0.4,
    space: 0.06, 'dead-space': 0.06, aisle: 0, zone: 0.03,
    registration: 0.05, stage: 2, food: 0.05, lounge: 0.05,
    restroom: 0.05, storage: 0.05, 'av-booth': 0.05,
    table: 2.5, chair: 1.5, stool: 2.5, display: 8, monitor: 6,
    shelf: 5, counter: 3.5,
    'table-8ft': 2.5, 'table-round-60': 2.5, 'cocktail-table': 3.5,
    'charging-table': 2.5, sofa: 2.4, 'lounge-chair': 2.4, 'cube-seat': 1.5,
    'coffee-table': 1.3, bar: 3.5, 'registration-counter': 3.5, podium: 4,
    'display-case': 3.2, kiosk: 7, tower: 12, 'banner-stand': 8,
    'led-poster': 6.5, 'poster-board': 6, 'grid-wall': 6,
    'entrance-unit': 12, carpet: 0.02, 'custom-room': 8,
    'fire-exit': 0.15, 'first-aid': 0.05, 'fire-lane': 0.02,
    'electrical-panel': 6, 'distro-box': 2.5, generator: 7,
    /* floor markings and annotations are not walls — keep them flat or
       out of the model entirely, or the walkthrough reads as a maze */
    'egress-path': 0, 'electrical-run': 0, arrow: 0, dimension: 0,
    text: 0, 'rigging-zone': 0, 'hanging-sign': 0, 'water-drop': 0,
    'network-drop': 0, 'power-drop': 0, 'rigging-point': 0, disconnect: 0,
  };

  /* Kinds drawn as cylinders — seats and round tables. */
  const ROUND = new Set(['chair', 'stool', 'cocktail-table', 'table-round-60',
                         'cube-seat']);

  const heightFor = (el, k) => {
    if (el.props?.deckHeight) return Number(el.props.deckHeight) / 12;
    if (el.kind === 'drape') return Number(el.props?.drapeHeight || 8);
    if (el.props?.height && HEIGHTS[el.kind] === undefined) return Number(el.props.height);
    if (HEIGHTS[el.kind] !== undefined) {
      /* explicit height prop wins for height-regulated kinds */
      if (el.props?.height && ['kiosk', 'tower', 'banner-stand', 'monitor',
                               'display', 'wall', 'entrance-unit', 'custom-room']
          .includes(el.kind)) return Number(el.props.height);
      return HEIGHTS[el.kind];
    }
    if (el.kind === 'stage-deck') return 2;
    if (el.shape === 'line') return 8;
    return 0.06;
  };

  const DRAPE_COLORS = { black: 0x24272e, blue: 0x27418f, white: 0xf2f2ef,
                         grey: 0x9aa0aa, red: 0x8f2733 };

  function colorFor(el, k) {
    if (el.kind === 'drape') return DRAPE_COLORS[el.props?.drapeColor] ?? 0x24272e;
    if (el.kind === 'space') {
      const st = FP.config.status(el.props?.status);
      return new THREE.Color(st?.color || k.fill || '#94a3b8').getHex();
    }
    return new THREE.Color(el.props?.color || k.fill || '#94a3b8').getHex();
  }

  /* ---------------- shell ---------------- */
  function buildOverlay() {
    overlay = document.createElement('div');
    overlay.className = 'v3d';
    overlay.innerHTML = `
      <div class="v3d-top">
        <b>3D preview</b>
        <span class="v3d-hint">Drag to orbit · scroll to zoom · right-drag to pan</span>
        <button class="btn ghost" id="v3dClose">Back to plan</button>
      </div>`;
    const stage = document.getElementById('stage')
               || document.getElementById('vStage') || document.body;
    stage.appendChild(overlay);
    overlay.querySelector('#v3dClose').onclick = close;
  }

  /* ---------------- scene build ---------------- */
  function rebuild() {
    /* wipe previous model */
    for (let i = scene.children.length - 1; i >= 0; i--) {
      const c = scene.children[i];
      if (c.userData.model) {
        scene.remove(c);
        c.traverse?.((o) => { o.geometry?.dispose(); o.material?.dispose?.(); });
      }
    }

    const model = new THREE.Group();
    model.userData.model = true;

    const W = FP.plan.width, H = FP.plan.height;

    /* floor: paper-white slab with a soft grid, sitting on a larger
       ground so the hall reads as a building in a space, not a raft */
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(W * 4, H * 4),
      new THREE.MeshStandardMaterial({ color: 0xe2e6ee, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(W / 2, -0.06, H / 2);
    ground.receiveShadow = true;
    model.add(ground);

    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(W, 0.1, H),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .95 }));
    floor.position.set(W / 2, -0.05, H / 2);
    floor.receiveShadow = true;
    model.add(floor);

    const grid = new THREE.GridHelper(Math.max(W, H), Math.max(W, H) / (FP.plan.grid || 5),
                                      0xd5dae4, 0xe8ebf2);
    grid.position.set(W / 2, 0.012, H / 2);
    grid.scale.set(W / Math.max(W, H), 1, H / Math.max(W, H));
    model.add(grid);

    /* hall perimeter: a low curb so the boundary reads without caging
       the camera */
    const curbMat = new THREE.MeshStandardMaterial({ color: 0x131a26, roughness: .6 });
    [[W / 2, -0.4, W, 0.8], [W / 2, H + 0.4, W, 0.8],
     [-0.4, H / 2, 0.8, H + 1.6], [W + 0.4, H / 2, 0.8, H + 1.6]].forEach(([cx, cz, sx, sz]) => {
      const curb = new THREE.Mesh(new THREE.BoxGeometry(sx, 1.2, sz), curbMat);
      curb.position.set(cx, 0.6, cz);
      curb.castShadow = true;
      model.add(curb);
    });

    /* elements — children carry absolute coordinates, so one flat pass */
    for (const el of FP.plan.elements || []) {
      const k = FP.config.kind(el.kind);
      const h = heightFor(el, k);
      if (h <= 0) continue;

      if (el.shape === 'line') {
        const g = el.geometry;
        if (g?.x1 === undefined) continue;
        const dx = g.x2 - g.x1, dy = g.y2 - g.y1;
        const len = Math.hypot(dx, dy);
        if (len < 0.1) continue;
        const t = Math.max(g.thickness || 0.5, 0.2);
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(len, h, t),
          new THREE.MeshStandardMaterial({ color: colorFor(el, k), roughness: .8 }));
        mesh.position.set((g.x1 + g.x2) / 2, h / 2, (g.y1 + g.y2) / 2);
        mesh.rotation.y = -Math.atan2(dy, dx);
        mesh.castShadow = mesh.receiveShadow = true;
        model.add(mesh);
        continue;
      }

      if (el.shape === 'marker') {
        const g = el.geometry;
        const mesh = new THREE.Mesh(
          new THREE.CylinderGeometry(0.5, 0.5, 1.2, 16),
          new THREE.MeshStandardMaterial({ color: colorFor(el, k), roughness: .7 }));
        mesh.position.set(g.x, 0.6, g.y);
        mesh.castShadow = true;
        model.add(mesh);
        continue;
      }

      if (el.shape !== 'rect') continue;         /* poly zones: skip in v1 */
      const g = el.geometry;
      if (!g || g.w === undefined) continue;

      const flat = h <= 0.1;
      const col = colorFor(el, k);
      const mat = new THREE.MeshStandardMaterial({
        color: col, roughness: .85,
        transparent: flat, opacity: flat ? .55 : 1,
      });

      let mesh;
      if (ROUND.has(el.kind)) {
        const r = Math.min(g.w, g.h) / 2;
        mesh = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.92, r * 0.92, h, 28), mat);
      } else {
        mesh = new THREE.Mesh(new THREE.BoxGeometry(g.w, h, g.h), mat);
      }
      mesh.position.set(g.x + g.w / 2, flat ? h / 2 + 0.011 : h / 2, g.y + g.h / 2);
      if (g.rot) mesh.rotation.y = -(g.rot * Math.PI) / 180;
      if (!flat) mesh.castShadow = mesh.receiveShadow = true;
      model.add(mesh);

      /* booth number floats above sold/held tiles */
      if (el.kind === 'space' && el.props?.number) {
        const spr = numberSprite(String(el.props.number));
        if (spr) {
          spr.position.set(g.x + g.w / 2, 2.2, g.y + g.h / 2);
          model.add(spr);
        }
      }
    }

    scene.add(model);
  }

  function numberSprite(text) {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 64;
    const x = c.getContext('2d');
    if (!x) return null;
    x.fillStyle = 'rgba(19,26,38,.82)';
    const r = 14;
    x.beginPath();
    x.roundRect(8, 6, 112, 52, r);
    x.fill();
    x.fillStyle = '#fff';
    x.font = '600 30px Inter, sans-serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText(text, 64, 33);
    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 4;
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true }));
    spr.scale.set(4, 2, 1);
    return spr;
  }

  /* ---------------- lifecycle ---------------- */
  async function open() {
    if (opened) return;
    opened = true;

    if (!overlay) buildOverlay();
    overlay.classList.add('show');

    if (!THREE) {
      overlay.querySelector('.v3d-top b').textContent = 'Loading 3D…';
      try {
        /* OrbitControls imports the bare specifier 'three', resolved by
           the import map in the page's <head>. */
        THREE = await import('three');
        Orbit = (await import('three/addons/controls/OrbitControls.js')).OrbitControls;
      } catch (e) {
        opened = false;
        overlay.classList.remove('show');
        FP.toast?.('Could not load the 3D engine — check your connection', true);
        return;
      }
      overlay.querySelector('.v3d-top b').textContent = '3D preview';
    }

    if (!renderer) {
      renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      overlay.appendChild(renderer.domElement);

      scene = new THREE.Scene();
      scene.background = new THREE.Color(0xeceff4);

      camera = new THREE.PerspectiveCamera(46, 1, 0.5, 4000);

      const hemi = new THREE.HemisphereLight(0xffffff, 0xd8dde6, 1.05);
      scene.add(hemi);
      const sun = new THREE.DirectionalLight(0xffffff, 1.6);
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      scene.add(sun);
      scene.userData.sun = sun;

      controls = new Orbit(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.maxPolarAngle = Math.PI * 0.49;

      /* the model follows every edit, so 3D can stay open while the
         other side moves furniture */
      FP.on?.('change', () => { if (opened) rebuild(); });
    }

    const W = FP.plan.width, H = FP.plan.height;
    const R = Math.max(W, H);
    camera.position.set(W / 2 - R * 0.55, R * 0.62, H / 2 + R * 0.85);
    controls.target.set(W / 2, 0, H / 2);
    const sun = scene.userData.sun;
    sun.position.set(W / 2 - R * 0.4, R * 0.9, H / 2 - R * 0.3);
    sun.shadow.camera.left = -R; sun.shadow.camera.right = R;
    sun.shadow.camera.top = R; sun.shadow.camera.bottom = -R;
    sun.shadow.camera.far = R * 4;

    rebuild();
    resize();
    root.addEventListener('resize', resize);
    loop();
  }

  function resize() {
    if (!renderer || !overlay) return;
    const w = overlay.clientWidth, h = overlay.clientHeight - 44;
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function loop() {
    if (!opened) return;
    raf = requestAnimationFrame(loop);
    controls.update();
    renderer.render(scene, camera);
  }

  function close() {
    opened = false;
    cancelAnimationFrame(raf);
    root.removeEventListener('resize', resize);
    overlay?.classList.remove('show');
  }

  FP.view3d = { open, close, toggle: () => (opened ? close() : open()) };

  /* self-wire: the button exists on pages that include this file */
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btn3D')?.addEventListener('click', FP.view3d.toggle);
  });
  document.getElementById('btn3D')?.addEventListener('click', FP.view3d.toggle);
})(window);
