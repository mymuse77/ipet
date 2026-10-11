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

const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(window.devicePixelRatio);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
camera.position.set(0, 1.35, 2.6);

scene.add(new THREE.AmbientLight(0xffffff, 1.1));
const dir = new THREE.DirectionalLight(0xffffff, 1.6);
dir.position.set(1.5, 3, 2);
scene.add(dir);

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
  if (mood === 'happy') hop(0.06 * petUnit);
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
    }
    framePet(petRoot);
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
  }
  renderer.render(scene, camera);
}
tick();

// 设置面板
initSettings(applyMood);
