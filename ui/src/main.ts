/**
 * ipet 前端渲染器:Three.js + @pixiv/three-vrm
 *
 * - 透明画布,宠物模型浮在桌面上
 * - 双管线:优先 VRM(表情/视线/骨骼全功能),普通 GLB 走待机动画管线
 * - 待机:呼吸浮动 + 眨眼(VRM)/待机动画(GLB) + 视线跟随鼠标(VRM)
 * - 监听 Tauri 事件:
 *   - ipet://reminder  提醒触发 -> 气泡 + 表情
 *   - ipet://mood      情绪切换   -> 表情/动作
 * - 按住拖拽移动窗口(调用 Tauri 的 startDragging)
 *
 * 模型:把宠物 GLB 放到 ui/public/assets/pet.glb
 * (默认是 Khronos 官方示例小狐狸,CC0+CC-BY,见 README 署名;
 *  也可以换成自己的 .vrm,管线自动识别)
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRM, VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { initSettings, tauriInvoke } from './settings';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const bubble = document.getElementById('bubble') as HTMLDivElement;
const hint = document.getElementById('hint') as HTMLDivElement;
const petTag = document.getElementById('pet-tag') as HTMLDivElement;
const petTagMood = document.getElementById('pet-tag-mood') as HTMLSpanElement;

const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(window.devicePixelRatio);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
camera.position.set(0, 1.35, 2.6);

// 三点式灯光:柔光 + 暖主光 + 冷轮廓光,宠物更有体积感
scene.add(new THREE.HemisphereLight(0xbfd9ff, 0x40342a, 0.85));
const keyLight = new THREE.DirectionalLight(0xfff1dd, 1.7);
keyLight.position.set(2.2, 4, 3);
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0x8fb4ff, 1.1);
rimLight.position.set(-3, 2.2, -2.5);
scene.add(rimLight);
const fillLight = new THREE.DirectionalLight(0xffffff, 0.35);
fillLight.position.set(-1.5, 1, 3.5);
scene.add(fillLight);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

let vrm: VRM | null = null;
let petRoot: THREE.Object3D | null = null; // 宠物根节点(VRM 或 GLB 通用)
let mixer: THREE.AnimationMixer | null = null; // GLB 待机动画用
let petUnit = 1; // 模型最大尺寸,用于缩放浮动/跳跃幅度
let petBaseRotY = 0; // 模型基础朝向(狐狸 bind pose 即面向镜头 +Z)
let headBone: THREE.Object3D | null = null; // 头部骨骼,视线跟随用
let tailBones: THREE.Object3D[] = []; // 尾巴骨骼,开心时摇尾巴
let wagUntil = 0; // 摇尾巴结束时间(秒)

/** 柔和的椭圆形投影,让宠物"站"在桌面上有实感 */
function makeBlobShadow(): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 6, 64, 64, 62);
  g.addColorStop(0, 'rgba(0,0,0,0.38)');
  g.addColorStop(0.6, 'rgba(0,0,0,0.18)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = -1;
  return mesh;
}
const blobShadow = makeBlobShadow();
blobShadow.visible = false;
scene.add(blobShadow);

/** 心情徽标:亲密度情绪 -> 小表情 */
const MOOD_EMOJI: Record<string, string> = { happy: '❤️', content: '🧡', lonely: '💜', sad: '💙' };
function updateMoodBadge(mood: string): void {
  petTagMood.textContent = MOOD_EMOJI[mood] ?? '🧡';
  petTag.classList.remove('hidden');
}
const clock = new THREE.Clock();
const mouse = new THREE.Vector2(0, 0);
window.addEventListener('pointermove', (e) => {
  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
});

// 拖拽移动窗口(Tauri 环境);轻点则视为"摸摸头"互动
let downPos: [number, number] | null = null;
canvas.addEventListener('mousedown', async (e) => {
  downPos = [e.clientX, e.clientY];
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().startDragging();
  } catch { /* 非 Tauri 环境(浏览器预览)忽略 */ }
});
canvas.addEventListener('mouseup', async (e) => {
  if (downPos && Math.hypot(e.clientX - downPos[0], e.clientY - downPos[1]) < 6) {
    try {
      const mood = await tauriInvoke<string>('affection_interact', { kind: 'pet' });
      applyMood(mood);
    } catch { /* 非 Tauri 环境忽略 */ }
  }
  downPos = null;
});

/** 亲密度情绪 -> 宠物反馈(VRM 切表情,GLB 跳一下) */
let hopOffset = 0; // 跳跃偏移,tick 里叠加(避免被呼吸浮动覆盖)
function hop(amount = 0.1, ms = 400) {
  hopOffset += amount;
  setTimeout(() => { hopOffset -= amount; }, ms);
}
function applyMood(mood: string): void {
  setExpression('happy', 0); setExpression('sad', 0); setExpression('surprised', 0);
  if (mood === 'happy') setExpression('happy', 0.9);
  else if (mood === 'sad') setExpression('sad', 0.9);
  else if (mood === 'lonely') setExpression('sad', 0.5);
  updateMoodBadge(mood);
  if (mood === 'happy') {
    hop(0.06 * petUnit);
    wagUntil = clock.elapsedTime + 2.2; // 开心摇尾巴
  }
}

/** 强提醒语音播报（可在设置里关闭） */
function speak(text: string): void {
  try {
    if (localStorage.getItem('ipet_voice') === 'off') return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN';
    window.speechSynthesis.speak(u);
  } catch { /* 不支持则静默 */ }
}

const loader = new GLTFLoader();
loader.register((parser) => new VRMLoaderPlugin(parser));

/** 按模型包围盒自动构图,让宠物填满窗口 */
function framePet(root: THREE.Object3D) {
  const box = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  petUnit = maxDim;
  const dist = maxDim * 1.8;
  camera.position.set(center.x, center.y + maxDim * 0.1, center.z + dist);
  camera.far = dist * 5; // 大模型需要更远的远平面
  camera.updateProjectionMatrix();
  camera.lookAt(center);
  // 投影放在宠物脚下
  blobShadow.position.set(center.x, box.min.y + maxDim * 0.005, center.z);
  blobShadow.scale.set(size.x * 1.15, size.z * 1.15, 1);
  blobShadow.visible = true;
}

loader.load(
  'assets/pet.glb',
  (gltf) => {
    const maybeVrm = gltf.userData.vrm as VRM | undefined;
    if (maybeVrm) {
      // VRM 管线:表情 / 视线 / 骨骼全功能(VRM 规范面向 +Z,无需旋转)
      vrm = maybeVrm;
      VRMUtils.removeUnnecessaryVertices(gltf.scene);
      VRMUtils.removeUnnecessaryJoints(gltf.scene);
      petRoot = vrm.scene;
      petBaseRotY = 0;
      scene.add(petRoot);
      console.log('[ipet] VRM 模型加载成功');
    } else {
      // GLB 管线:播放待机动画(Survey/Idle),呼吸浮动
      petRoot = gltf.scene;
      petBaseRotY = 0;
      scene.add(petRoot);
      if (gltf.animations.length > 0) {
        mixer = new THREE.AnimationMixer(petRoot);
        const idle =
          gltf.animations.find((c) => /survey|idle/i.test(c.name)) ?? gltf.animations[0];
        mixer.clipAction(idle).play();
        console.log('[ipet] GLB 宠物加载成功,待机动画:', idle.name);
      } else {
        console.log('[ipet] GLB 宠物加载成功(无动画)');
      }
      // 找头部/尾巴骨骼:视线跟随 + 开心摇尾巴
      headBone = petRoot.getObjectByName('b_Head_05') ?? null;
      tailBones = ['b_Tail01_012', 'b_Tail02_013', 'b_Tail03_014']
        .map((n) => petRoot!.getObjectByName(n))
        .filter((b): b is THREE.Object3D => b !== undefined);
    }
    framePet(petRoot);
    petTag.classList.remove('hidden');
    // 拉一次当前心情,点亮徽标
    tauriInvoke<{ mood: string }>('affection_get').then(
      (a) => updateMoodBadge(a.mood),
      () => updateMoodBadge('content'),
    );
  },
  undefined,
  () => {
    hint.textContent =
      '没有找到宠物模型\n请下载 pet.glb 放到 ui/public/assets/\n见 README「模型」一节,一条命令即可';
    hint.classList.remove('hidden');
    console.warn('[ipet] 未找到 assets/pet.glb');
  },
);

// 表情工具
function setExpression(name: string, value: number) {
  vrm?.expressionManager?.setValue(name, value);
}

// 眨眼计时器
let nextBlink = 2;
function updateBlink(t: number) {
  if (t > nextBlink) {
    nextBlink = t + 2 + Math.random() * 3;
    setExpression('blink', 1);
    setTimeout(() => setExpression('blink', 0), 150);
  }
}

// 提醒气泡
let bubbleTimer: number | undefined;
function showBubble(text: string, ms = 6000) {
  bubble.textContent = text;
  bubble.classList.remove('hidden');
  window.clearTimeout(bubbleTimer);
  bubbleTimer = window.setTimeout(() => bubble.classList.add('hidden'), ms);
}

// Tauri 事件
async function bindTauriEvents() {
  try {
    const { listen } = await import('@tauri-apps/api/event');
    await listen('ipet://reminder', (e: any) => {
      const p = e.payload as { message: string; kind: string; level: string };
      showBubble(p.message, p.level === 'gentle' ? 5000 : 9000);
      // 提醒时开心表情 + 跳一下
      setExpression('happy', 0.8);
      hop(0.075 * petUnit, 1200);
      setTimeout(() => setExpression('happy', 0), 1200);
      // 强提醒语音播报
      if (p.level === 'strong') speak(p.message);
    });
    await listen('ipet://mood', (e: any) => {
      const mood = (e.payload as { mood: string }).mood;
      setExpression('happy', 0); setExpression('sad', 0); setExpression('angry', 0);
      if (['happy', 'sad', 'angry', 'surprised'].includes(mood)) setExpression(mood, 0.9);
    });
    console.log('[ipet] Tauri 事件已绑定');
  } catch { /* 浏览器预览模式 */ }
}
bindTauriEvents();

// 主循环:VRM 走表情/视线/眨眼管线,GLB 走待机动画管线
function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  if (vrm && petRoot) {
    petRoot.position.y = Math.sin(t * 1.6) * 0.03 + hopOffset; // 呼吸浮动
    petRoot.rotation.y = petBaseRotY + Math.sin(t * 0.5) * 0.06;
    vrm.lookAt?.target?.position.set(mouse.x * 2, 1.35 + mouse.y, 1.5);
    vrm.update(dt);
    updateBlink(t);
  } else if (petRoot) {
    mixer?.update(dt);
    petRoot.position.y = Math.abs(Math.sin(t * 2.0)) * 0.002 * petUnit + hopOffset; // 轻微浮动
    petRoot.rotation.y = petBaseRotY + Math.sin(t * 0.5) * 0.08;
    // 头部视线跟随鼠标(叠加在待机动画之上,柔和插值)
    if (headBone) {
      const k = Math.min(1, dt * 3.5);
      const ty = THREE.MathUtils.clamp(mouse.x * 0.45, -0.4, 0.4);
      const tx = THREE.MathUtils.clamp(-mouse.y * 0.28, -0.22, 0.22);
      headBone.rotation.y += (ty - headBone.rotation.y) * k;
      headBone.rotation.x += (tx - headBone.rotation.x) * k;
    }
    // 开心时摇尾巴(叠加在待机动画之上,结束后动画自动接管)
    if (t < wagUntil) {
      const w = Math.sin(t * 14) * 0.45;
      tailBones.forEach((b, i) => { b.rotation.y += w * (1 - i * 0.2); });
    }
  }
  renderer.render(scene, camera);
}
tick();

// 设置面板
initSettings(applyMood);
