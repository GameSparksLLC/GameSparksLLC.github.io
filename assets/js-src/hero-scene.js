import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const assetUrl = (file) => new URL(`../hero/luna/${file}`, import.meta.url).href;

// Load the compressed character, reuse Luna's game textures, and mount a lightweight interactive scene.
export async function mountHeroScene(canvas, stage) {
  const context = canvas.getContext("webgl2", { alpha: true, antialias: false, powerPreference: "low-power" });
  if (!context) throw new Error("WebGL is unavailable.");

  const renderer = new THREE.WebGLRenderer({ canvas, context, alpha: true, antialias: false, powerPreference: "low-power" });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const cameraViewHeight = 2 * 3.9 * Math.tan(THREE.MathUtils.degToRad(17));
  const camera = new THREE.OrthographicCamera(-cameraViewHeight / 2, cameraViewHeight / 2, cameraViewHeight / 2, -cameraViewHeight / 2, 0.1, 100);
  camera.position.set(0, 0.8, 3.9);
  camera.lookAt(0, 0.8, 0);

  const compressedResponse = await fetch(assetUrl("luna-showcase.glb.gz"), { cache: "force-cache", priority: "low" });
  if (!compressedResponse.ok) throw new Error(`Luna model request failed: ${compressedResponse.status}`);
  if (!("DecompressionStream" in window)) throw new Error("This browser cannot decompress the optimized character asset.");

  const compressedData = await compressedResponse.arrayBuffer();
  const modelData = await new Response(new Blob([compressedData]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
  const gltf = await new GLTFLoader().parseAsync(modelData, assetUrl(""));
  const model = gltf.scene;

  const textureLoader = new THREE.TextureLoader();
  const [bodyTexture, headTexture, hairTexture] = await Promise.all([
    textureLoader.loadAsync(assetUrl("body.webp")),
    textureLoader.loadAsync(assetUrl("head.webp")),
    textureLoader.loadAsync(assetUrl("hair.webp")),
  ]);

  [bodyTexture, headTexture, hairTexture].forEach((texture) => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 4);
  });

  const modelMaterials = [];
  model.traverse((object) => {
    if (!object.isMesh) return;

    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const mappedMaterials = materials.map((material) => {
      const name = material.name.toLowerCase();
      const texture = name.includes("hair") ? hairTexture : name.includes("head") ? headTexture : bodyTexture;
      const mapped = new THREE.MeshBasicMaterial({
        name: material.name,
        color: 0xffffff,
        map: texture,
        transparent: material.transparent,
        alphaTest: material.alphaTest,
        side: material.side,
      });
      modelMaterials.push({
        material: mapped,
        texture,
        transparent: mapped.transparent,
        alphaTest: mapped.alphaTest,
      });
      return mapped;
    });

    object.material = Array.isArray(object.material) ? mappedMaterials : mappedMaterials[0];
    object.frustumCulled = false;
  });

  const normalization = new THREE.Group();
  normalization.add(model);

  const bounds = new THREE.Box3().setFromObject(normalization);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const modelScale = 3.9 / size.y;
  normalization.scale.setScalar(modelScale);
  normalization.position.set(-center.x * modelScale, -center.y * modelScale, -center.z * modelScale);

  const spinRoot = new THREE.Group();
  spinRoot.rotation.y = Math.PI;
  spinRoot.add(normalization);
  scene.add(spinRoot);

  // Play the single trimmed idle clip; the arm pose is fixed into the site model.
  const idleClip = THREE.AnimationClip.findByName(gltf.animations, "Idle");
  if (!idleClip) throw new Error("Luna model is missing its idle animation.");
  const poseMixer = new THREE.AnimationMixer(model);
  const poseAction = poseMixer.clipAction(idleClip);
  poseAction.setEffectiveWeight(0.5);
  poseAction.play();

  const expressionTargets = [];
  const blinkTargets = [];
  model.traverse((object) => {
    const dictionary = object.morphTargetDictionary;
    const influences = object.morphTargetInfluences;
    if (!dictionary || !influences) return;

    if (dictionary.Good !== undefined) expressionTargets.push({ influences, index: dictionary.Good });
    ["Blink_L", "Blink_R"].forEach((name) => {
      if (dictionary[name] !== undefined) blinkTargets.push({ influences, index: dictionary[name] });
    });
  });
  expressionTargets.forEach(({ influences, index }) => { influences[index] = 0.5; });
  let nextBlinkIn = 3 + Math.random() * 2.5;
  let blinkElapsed = -1;

  // Ease Luna's eyelids shut and open between irregular pauses.
  const updateBlink = (delta) => {
    if (blinkTargets.length === 0) return;
    if (blinkElapsed < 0) {
      nextBlinkIn -= delta;
      if (nextBlinkIn > 0) return;
      blinkElapsed = 0;
    }

    blinkElapsed += delta;
    const closeDuration = 0.13;
    const holdDuration = 0.035;
    const openDuration = 0.17;
    const ease = (value) => value * value * (3 - 2 * value);
    let amount = 0;
    if (blinkElapsed < closeDuration) amount = ease(blinkElapsed / closeDuration);
    else if (blinkElapsed < closeDuration + holdDuration) amount = 1;
    else if (blinkElapsed < closeDuration + holdDuration + openDuration) {
      amount = 1 - ease((blinkElapsed - closeDuration - holdDuration) / openDuration);
    }
    else {
      blinkElapsed = -1;
      nextBlinkIn = 3 + Math.random() * 4.5;
    }
    blinkTargets.forEach(({ influences, index }) => { influences[index] = amount; });
  };

  const wireframeToggle = stage.querySelector(".wireframe-toggle");
  const wireframeLabel = wireframeToggle?.querySelector("span");
  let wireframeEnabled = false;
  const onWireframeToggle = () => {
    wireframeEnabled = !wireframeEnabled;
    modelMaterials.forEach(({ material, texture, transparent, alphaTest }) => {
      material.wireframe = wireframeEnabled;
      material.map = wireframeEnabled ? null : texture;
      material.color.set(wireframeEnabled ? 0x302633 : 0xffffff);
      material.transparent = wireframeEnabled ? false : transparent;
      material.alphaTest = wireframeEnabled ? 0 : alphaTest;
      material.needsUpdate = true;
    });
    wireframeToggle.setAttribute("aria-pressed", String(wireframeEnabled));
    wireframeToggle.setAttribute("aria-label", `Turn wireframe ${wireframeEnabled ? "off" : "on"}`);
    wireframeLabel.textContent = `Wireframe: ${wireframeEnabled ? "On" : "Off"}`;
    renderer.render(scene, camera);
  };

  wireframeToggle?.addEventListener("click", onWireframeToggle);
  let previousFrame = 0;
  let frameId = 0;
  let disposed = false;

  // Fit the orthographic camera and renderer to the character frame.
  const resize = () => {
    const { width, height } = canvas.parentElement.getBoundingClientRect();
    if (!width || !height) return;
    const halfHeight = cameraViewHeight / 2;
    const halfWidth = halfHeight * (width / height);
    camera.left = -halfWidth;
    camera.right = halfWidth;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    renderer.render(scene, camera);
  };

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(stage);
  resize();

  // Advance and render Luna while the showcase is visible.
  const animate = (time) => {
    frameId = 0;
    if (disposed || document.hidden || !stageVisible) return;

    const delta = Math.min((time - (previousFrame || time)) / 1000, 0.05);
    previousFrame = time;
    poseMixer.update(delta);
    expressionTargets.forEach(({ influences, index }) => { influences[index] = 0.5; });
    updateBlink(delta);
    renderer.render(scene, camera);
    frameId = window.requestAnimationFrame(animate);
  };

  // Start rendering only when the tab and showcase are visible.
  const startAnimation = () => {
    if (disposed || document.hidden || !stageVisible || frameId) return;
    frameId = window.requestAnimationFrame(animate);
  };

  // Stop queued frames while the showcase is outside the viewport.
  const stopAnimation = () => {
    if (!frameId) return;
    window.cancelAnimationFrame(frameId);
    frameId = 0;
  };

  let stageVisible = !("IntersectionObserver" in window);

  // Pause the character loop after the visitor scrolls away from the hero.
  const onStageIntersection = (entries) => {
    stageVisible = entries.some((entry) => entry.isIntersecting);
    if (stageVisible) {
      previousFrame = 0;
      startAnimation();
    } else {
      stopAnimation();
    }
  };

  const stageObserver = "IntersectionObserver" in window
    ? new IntersectionObserver(onStageIntersection, { threshold: 0 })
    : null;
  stageObserver?.observe(stage);

  const startX = { value: 0 };
  const onPointerDown = (event) => {
    startX.value = event.clientX;
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add("is-dragging");
  };

  const onPointerMove = (event) => {
    if (!canvas.hasPointerCapture(event.pointerId)) return;
    const deltaX = event.clientX - startX.value;
    spinRoot.rotation.y += deltaX * 0.009;
    startX.value = event.clientX;
    renderer.render(scene, camera);
  };

  const onPointerEnd = (event) => {
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    canvas.classList.remove("is-dragging");
  };

  const onKeyDown = (event) => {
    const amount = 0.12;
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "ArrowLeft") spinRoot.rotation.y -= amount;
    if (event.key === "ArrowRight") spinRoot.rotation.y += amount;
    renderer.render(scene, camera);
  };

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerEnd);
  canvas.addEventListener("pointercancel", onPointerEnd);
  canvas.addEventListener("keydown", onKeyDown);
  // Preserve the browser's ability to restore the showcase after GPU context loss.
  const onContextLost = (event) => {
    event.preventDefault();
    stopAnimation();
  };

  // Resize and resume rendering after the GPU restores the canvas context.
  const onContextRestored = () => {
    resize();
    previousFrame = 0;
    startAnimation();
  };

  canvas.addEventListener("webglcontextlost", onContextLost);
  canvas.addEventListener("webglcontextrestored", onContextRestored);

  // Restart the animation clock after a backgrounded tab returns.
  const onVisibilityChange = () => {
    if (document.hidden) {
      stopAnimation();
      return;
    }
    previousFrame = 0;
    startAnimation();
  };
  document.addEventListener("visibilitychange", onVisibilityChange);

  stage.classList.add("hero-art-loaded");
  startAnimation();

  window.addEventListener("pagehide", () => {
    disposed = true;
    window.cancelAnimationFrame(frameId);
    resizeObserver.disconnect();
    stageObserver?.disconnect();
    poseMixer.stopAllAction();
    wireframeToggle?.removeEventListener("click", onWireframeToggle);
    canvas.removeEventListener("webglcontextlost", onContextLost);
    canvas.removeEventListener("webglcontextrestored", onContextRestored);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    renderer.dispose();
  }, { once: true });
}
