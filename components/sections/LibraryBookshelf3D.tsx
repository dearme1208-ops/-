"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { DailyTask } from "@/lib/types";
import { formatMsClock } from "@/lib/time";

// 図書館モード「完了」タブの本気版書架。CSSの疑似3Dではなく実際のWebGL(three.js)で
// 木製の書架と本を描画し、ドラッグで視点を回せるようにする。他の演出テーマ・
// 他のモードには一切影響しない(このファイル自体、library モードで完了タブを開いた
// 瞬間にnext/dynamic経由で遅延読み込みされ、選ばなければバンドルにも実行にも乗らない)
const SHELF_WIDTH = 6.4;
const SHELF_DEPTH = 0.9;
const SHELF_GAP = 0.05;
const BOARD_THICKNESS = 0.08;
const SHELF_RISE = 1.7;

function hashString(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  return hash;
}

function colorForCategory(category: string): THREE.Color {
  const hue = hashString(category) % 360;
  return new THREE.Color().setHSL(hue / 360, 0.42, 0.3);
}

interface BookPlacement {
  task: DailyTask;
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  depth: number;
  tiltZ: number;
  tiltY: number;
}

function layoutBooks(tasks: DailyTask[]): { books: BookPlacement[]; shelfCount: number } {
  const books: BookPlacement[] = [];
  let cursorX = -SHELF_WIDTH / 2;
  let shelfIndex = 0;
  for (const task of tasks) {
    const idHash = hashString(task.id);
    const minutes = task.accumulatedMs / 60000;
    const width = Math.min(0.55, Math.max(0.16, 0.16 + minutes * 0.01));
    const height = 1.02 + ((idHash >> 3) % 6) * 0.055;
    const depth = SHELF_DEPTH - 0.15;
    if (cursorX + width > SHELF_WIDTH / 2) {
      shelfIndex += 1;
      cursorX = -SHELF_WIDTH / 2;
    }
    const tiltZ = (((idHash % 11) - 5) / 5) * 0.05;
    const tiltY = (((idHash >> 5) % 7) - 3) * 0.01;
    books.push({
      task,
      x: cursorX + width / 2,
      y: shelfIndex * SHELF_RISE + height / 2 + BOARD_THICKNESS,
      z: 0,
      width,
      height,
      depth,
      tiltZ,
      tiltY,
    });
    cursorX += width + SHELF_GAP;
  }
  return { books, shelfCount: shelfIndex + 1 };
}

export default function LibraryBookshelf3D({ tasks }: { tasks: DailyTask[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<DailyTask | null>(null);

  useEffect(() => {
    const containerEl = containerRef.current;
    if (!containerEl || tasks.length === 0) return;
    const container = containerEl;

    const width = container.clientWidth;
    const height = container.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf3e9d2);
    scene.fog = new THREE.Fog(0xf3e9d2, 8, 20);

    const { books, shelfCount } = layoutBooks(tasks);

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100);
    const centerY = (shelfCount * SHELF_RISE) / 2;
    camera.position.set(0, centerY + 1.4, 6.5);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, centerY, 0);
    controls.enablePan = false;
    controls.minDistance = 3.5;
    controls.maxDistance = 11;
    controls.maxPolarAngle = Math.PI * 0.55;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.update();

    const ambient = new THREE.AmbientLight(0xfff2df, 0.65);
    scene.add(ambient);
    const key = new THREE.DirectionalLight(0xfff0d8, 1.1);
    key.position.set(4, 7, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -6;
    key.shadow.camera.right = 6;
    key.shadow.camera.top = 6;
    key.shadow.camera.bottom = -6;
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xffe3c0, 0.35);
    rim.position.set(-5, 3, -4);
    scene.add(rim);

    // 書架本体(側板+各段の棚板)
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x5b3f2b, roughness: 0.85, metalness: 0.05 });
    const shelfGroup = new THREE.Group();
    for (let i = 0; i < shelfCount; i++) {
      const board = new THREE.Mesh(new THREE.BoxGeometry(SHELF_WIDTH + 0.3, BOARD_THICKNESS, SHELF_DEPTH), woodMat);
      board.position.set(0, i * SHELF_RISE, 0);
      board.receiveShadow = true;
      board.castShadow = true;
      shelfGroup.add(board);
    }
    const topBoard = new THREE.Mesh(new THREE.BoxGeometry(SHELF_WIDTH + 0.3, BOARD_THICKNESS, SHELF_DEPTH), woodMat);
    topBoard.position.set(0, shelfCount * SHELF_RISE, 0);
    topBoard.receiveShadow = true;
    shelfGroup.add(topBoard);
    for (const side of [-1, 1]) {
      const panel = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, shelfCount * SHELF_RISE + BOARD_THICKNESS, SHELF_DEPTH),
        woodMat
      );
      panel.position.set((side * (SHELF_WIDTH + 0.3)) / 2, (shelfCount * SHELF_RISE) / 2, 0);
      panel.castShadow = true;
      panel.receiveShadow = true;
      shelfGroup.add(panel);
    }
    scene.add(shelfGroup);

    // 本(タスク)本体
    const bookMeshes: { mesh: THREE.Mesh; task: DailyTask }[] = [];
    for (const b of books) {
      const geo = new THREE.BoxGeometry(b.width, b.height, b.depth);
      const mat = new THREE.MeshStandardMaterial({ color: colorForCategory(b.task.category), roughness: 0.7, metalness: 0.08 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(b.x, b.y, b.z);
      mesh.rotation.z = b.tiltZ;
      mesh.rotation.y = b.tiltY;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
      bookMeshes.push({ mesh, task: b.task });
    }

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pointerDownPos: { x: number; y: number } | null = null;

    function onPointerDown(e: PointerEvent) {
      pointerDownPos = { x: e.clientX, y: e.clientY };
    }
    function onPointerUp(e: PointerEvent) {
      if (!pointerDownPos) return;
      const moved = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
      pointerDownPos = null;
      if (moved > 6) return; // ドラッグ(視点回転)はクリック判定しない
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(bookMeshes.map((b) => b.mesh))[0];
      if (hit) {
        const found = bookMeshes.find((b) => b.mesh === hit.object);
        if (found) setSelected(found.task);
      }
    }
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);

    let raf = 0;
    function animate() {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    }
    animate();

    function handleResize() {
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    return () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      controls.dispose();
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
          else obj.material.dispose();
        }
      });
      renderer.dispose();
      if (renderer.domElement.parentNode === container) container.removeChild(renderer.domElement);
    };
  }, [tasks]);

  if (tasks.length === 0) {
    return <p className="panel p-4 text-center text-sm text-cream/50">まだ書架に並んだ作業はありません</p>;
  }

  return (
    <div className="panel space-y-2 p-4">
      <p className="text-xs text-cream/50">
        本日読了(完了)した作業: {tasks.length}件　—　ドラッグで書架を回せます。本をタップすると詳細が出ます。
      </p>
      <div ref={containerRef} className="overflow-hidden rounded-md" style={{ width: "100%", height: 320, touchAction: "none" }} />
      {selected && (
        <div className="flex items-start justify-between gap-2 rounded-md bg-ink/10 p-2 text-xs">
          <div>
            <p className="font-bold text-ink">
              {selected.category} / {selected.name}
            </p>
            <p className="text-ink/60">所要時間: {formatMsClock(selected.accumulatedMs)}</p>
          </div>
          <button className="text-ink/40 hover:text-alert" onClick={() => setSelected(null)} aria-label="閉じる">
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
