/**
 * ipet 前端渲染器:Three.js + @pixiv/three-vrm
 *
 * - 透明画布,VRM 模型浮在桌面上
 * - 待机:呼吸浮动 + 随机眨眼 + 视线跟随鼠标
 * - 监听 Tauri 事件:
 *   - ipet://reminder  提醒触发 -> 气泡 + 表情
 *   - ipet://mood      情绪切换   -> 表情/动作
 * - 按住拖拽移动窗口(调用 Tauri 的 startDragging)
 *
 * 模型:把 VRM 文件放到 ui/public/assets/model.vrm
 * (可用 VRoid Studio 免费导出,或从 VRM 示例模型获取)
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

/** 亲密度情绪 -> 宠物表情 */
function applyMood(mood: string): void {
  setExpression('happy', 0); setExpression('sad', 0); setExpression('surprised', 0);
  if (mood === 'happy') setExpression('happy', 0.9);
  else if (mood === 'sad') setExpression('sad', 0.9);
  else if (mood === 'lonely') setExpression('sad', 0.5);
  if (mood === 'happy') {
    if (vrm) vrm.scene.position.y += 0.1;
    setTimeout(() => { if (vrm) vrm.scene.position.y -= 0.1; }, 400);
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

loader.load(
  'assets/model.vrm',
  (gltf) => {
    vrm = gltf.userData.vrm as VRM;
    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    VRMUtils.removeUnnecessaryJoints(gltf.scene);
    // VRM 模型默认面向 +Z（镜头方向），无需旋转
    scene.add(vrm.scene);
    console.log('[ipet] VRM 模型加载成功');
  },
  undefined,
  () => {
    hint.textContent =
      '没有找到 VRM 模型\n请把 .vrm 文件放到 ui/public/assets/model.vrm\n可用 VRoid Studio 免费制作导出';
    hint.classList.remove('hidden');
    console.warn('[ipet] 未找到 assets/model.vrm');
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
      if (vrm) vrm.scene.position.y += 0.12;
      setTimeout(() => {
        setExpression('happy', 0);
        if (vrm) vrm.scene.position.y -= 0.12;
      }, 1200);
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

// 主循环:呼吸浮动 + 眨眼 + 视线跟随
function tick() {
  requestAnimationFrame(tick);
  const t = clock.getElapsedTime();
  if (vrm) {
    vrm.scene.position.y = Math.sin(t * 1.6) * 0.03; // 呼吸浮动
    vrm.scene.rotation.y = Math.sin(t * 0.5) * 0.06;
    vrm.lookAt?.target?.position.set(mouse.x * 2, 1.35 + mouse.y, 1.5);
    vrm.update(t);
    updateBlink(t);
  }
  renderer.render(scene, camera);
}
tick();

// 设置面板
initSettings(applyMood);
