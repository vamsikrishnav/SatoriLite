(function () {
  const canvas = document.getElementById('vault-hero-canvas');
  if (!canvas || !window.THREE) return;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, canvas.clientWidth / canvas.clientHeight, 0.1, 1000);
  camera.position.set(6, 1, 36);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setSize(canvas.clientWidth, canvas.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const ambientLight = new THREE.AmbientLight(0x4a4060, 0.4);
  scene.add(ambientLight);
  const pointLight1 = new THREE.PointLight(0xc66b6b, 1.8, 50);
  pointLight1.position.set(10, 10, 10);
  scene.add(pointLight1);
  const pointLight2 = new THREE.PointLight(0x8b7390, 1.2, 50);
  pointLight2.position.set(-10, -5, 8);
  scene.add(pointLight2);

  // Offset the whole network to the right side — fully visible, closer to card
  const networkGroup = new THREE.Group();
  networkGroup.position.set(11, 0, 0);
  scene.add(networkGroup);

  // Central node — smooth sphere with coral glow
  const centralGeo = new THREE.IcosahedronGeometry(3, 2);
  const centralMat = new THREE.MeshPhongMaterial({
    color: 0x9a4e4e,
    emissive: 0x4a1818,
    shininess: 100,
    transparent: true,
    opacity: 0.65
  });
  const centralNode = new THREE.Mesh(centralGeo, centralMat);
  networkGroup.add(centralNode);

  const centralWire = new THREE.Mesh(
    new THREE.IcosahedronGeometry(3.4, 2),
    new THREE.MeshBasicMaterial({ color: 0xe0c8c0, wireframe: true, transparent: true, opacity: 0.4 })
  );
  networkGroup.add(centralWire);

  // Orbiting nodes
  const nodes = [];
  const nodeCount = 30;
  const colors = [0xc66b6b, 0xd4937e, 0x8b7390, 0xc49a82, 0x9b7bc6, 0x6bb8b8];

  for (let i = 0; i < nodeCount; i++) {
    const radius = 6 + Math.random() * 10;
    const theta = Math.random() * Math.PI * 2;
    const phi = (Math.random() - 0.5) * Math.PI;

    const x = radius * Math.cos(phi) * Math.cos(theta);
    const y = radius * Math.sin(phi);
    const z = radius * Math.cos(phi) * Math.sin(theta);

    const size = 0.3 + Math.random() * 0.5;
    const geo = new THREE.IcosahedronGeometry(size, 0);
    const color = colors[i % colors.length];
    const mat = new THREE.MeshPhongMaterial({
      color: color,
      emissive: color,
      emissiveIntensity: 0.2,
      shininess: 60,
      transparent: true,
      opacity: 0.6
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    networkGroup.add(mesh);

    nodes.push({
      mesh, radius, theta, phi,
      speed: 0.08 + Math.random() * 0.12,
      phiSpeed: (Math.random() - 0.5) * 0.03
    });
  }

  // Connections — rose-gold lines between nearby nodes
  const lineMaterial = new THREE.LineBasicMaterial({
    color: 0xc49a82,
    transparent: true,
    opacity: 0.2
  });

  const connections = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const d = nodes[i].mesh.position.distanceTo(nodes[j].mesh.position);
      if (d < 9) {
        const geo = new THREE.BufferGeometry().setFromPoints([
          nodes[i].mesh.position.clone(),
          nodes[j].mesh.position.clone()
        ]);
        const line = new THREE.Line(geo, lineMaterial.clone());
        networkGroup.add(line);
        connections.push({ line, i, j });
      }
    }
  }

  // Background particles
  const particleCount = 180;
  const particleGeo = new THREE.BufferGeometry();
  const positions = new Float32Array(particleCount * 3);
  for (let i = 0; i < particleCount * 3; i++) {
    positions[i] = (Math.random() - 0.5) * 60;
  }
  particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const particleMat = new THREE.PointsMaterial({
    color: 0xf0e6dc,
    size: 0.05,
    transparent: true,
    opacity: 0.35
  });
  const particles = new THREE.Points(particleGeo, particleMat);
  scene.add(particles);

  // Mouse tracking
  let mouseX = 0, mouseY = 0;
  document.addEventListener('mousemove', (e) => {
    mouseX = (e.clientX / window.innerWidth - 0.5) * 2;
    mouseY = (e.clientY / window.innerHeight - 0.5) * 2;
  });

  // Resize
  window.addEventListener('resize', () => {
    if (!canvas.offsetParent) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });

  let running = true;

  function animate() {
    if (!running) return;
    requestAnimationFrame(animate);
    const time = Date.now() * 0.001;

    centralNode.rotation.x = time * 0.15;
    centralNode.rotation.y = time * 0.2;
    centralWire.rotation.x = -time * 0.1;
    centralWire.rotation.y = -time * 0.18;

    for (const node of nodes) {
      node.theta += node.speed * 0.004;
      node.phi += node.phiSpeed * 0.004;
      node.mesh.position.set(
        node.radius * Math.cos(node.phi) * Math.cos(node.theta),
        node.radius * Math.sin(node.phi),
        node.radius * Math.cos(node.phi) * Math.sin(node.theta)
      );
      node.mesh.rotation.x = time * 0.4;
      node.mesh.rotation.y = time * 0.25;
    }

    for (const conn of connections) {
      const posAttr = conn.line.geometry.attributes.position;
      const a = nodes[conn.i].mesh.position;
      const b = nodes[conn.j].mesh.position;
      posAttr.setXYZ(0, a.x, a.y, a.z);
      posAttr.setXYZ(1, b.x, b.y, b.z);
      posAttr.needsUpdate = true;
      conn.line.material.opacity = Math.max(0, 0.25 - a.distanceTo(b) * 0.025);
    }

    particles.rotation.y = time * 0.012;
    particles.rotation.x = time * 0.006;

    camera.position.x += (mouseX * 2 - camera.position.x) * 0.015;
    camera.position.y += (-mouseY * 1.2 - camera.position.y) * 0.015;
    camera.lookAt(0, 0, 0);

    renderer.render(scene, camera);
  }
  animate();

  // Pause/resume when vault chooser is hidden/shown
  const observer = new MutationObserver(() => {
    const chooser = document.getElementById('vault-chooser');
    if (!chooser) return;
    if (chooser.classList.contains('hidden')) {
      running = false;
    } else {
      if (!running) {
        running = true;
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        if (w && h) {
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          renderer.setSize(w, h);
        }
        animate();
      }
    }
  });
  const chooser = document.getElementById('vault-chooser');
  if (chooser) {
    observer.observe(chooser, { attributes: true, attributeFilter: ['class'] });
  }
})();
