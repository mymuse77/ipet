/**
 * ipet 设置面板(大气版)
 *
 * - 顶部:头像 + 标题 + 版本
 * - 分段式 tabs:⏰ 提醒 / 🤖 Agent / 🐾 宠物
 * - 卡片式布局,iOS 风格开关,toast 反馈
 * - 非 Tauri 环境(浏览器预览)下降级提示,不抛错
 */

export async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const w = window as unknown as Record<string, unknown>;
  if (!w['__TAURI__']) throw new Error('当前不在 Tauri 环境中');
  const { invoke } = await import('@tauri-apps/api/core');
  return (invoke as (c: string, a?: unknown) => Promise<T>)(cmd, args);
}

function el(html: string): HTMLElement {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ---------- toast ---------- */
let toastTimer: number | undefined;
function toast(msg: string): void {
  let t = document.getElementById('ipet-toast');
  if (!t) {
    t = el(`<div id="ipet-toast" class="hidden"></div>`);
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.remove('hidden');
  window.clearTimeout(toastTimer);
  const box = t;
  toastTimer = window.setTimeout(() => box.classList.add('hidden'), 2200);
}

/* ---------- iOS 风格开关 ---------- */
function switchEl(initial: boolean, onChange: (v: boolean) => void): HTMLButtonElement {
  const b = el(
    `<button class="switch${initial ? ' on' : ''}" role="switch" aria-checked="${initial}"><span class="knob"></span></button>`,
  ) as HTMLButtonElement;
  b.onclick = () => {
    const v = !b.classList.contains('on');
    b.classList.toggle('on', v);
    b.setAttribute('aria-checked', String(v));
    onChange(v);
  };
  return b;
}

const KIND_LABEL: Record<string, string> = { water: '喝水', eye_rest: '远眺', break: '休息', custom: '自定义' };
const LEVEL_META: Record<string, { label: string; cls: string }> = {
  gentle: { label: '轻推', cls: 'lv-gentle' },
  normal: { label: '普通', cls: 'lv-normal' },
  strong: { label: '强提醒', cls: 'lv-strong' },
};
const AFF_EMOJI: Record<string, string> = { happy: '😊', content: '🙂', lonely: '🥺', sad: '😢' };
const AFF_LABEL: Record<string, string> = { happy: '开心', content: '平静', lonely: '孤单', sad: '蔫了' };

/* ================= 主入口 ================= */

export function initSettings(onMood: (mood: string) => void): void {
  if (document.getElementById('ipet-gear')) return; // 防重复初始化
  document.body.appendChild(el(`<button id="ipet-gear" title="设置">⚙</button>`));

  const panel = el(`
  <div id="ipet-settings" class="hidden">
    <div class="ipet-head">
      <div class="ipet-avatar">🦊</div>
      <div class="ipet-head-text">
        <div class="ipet-title">ipet 设置</div>
        <div class="ipet-ver">v0.1.0 · 桌面宠物</div>
      </div>
      <button id="ipet-settings-close" title="关闭">✕</button>
    </div>
    <div class="ipet-seg">
      <button data-tab="reminders" class="active">⏰ 提醒</button>
      <button data-tab="agent">🤖 Agent</button>
      <button data-tab="pet">🐾 宠物</button>
    </div>
    <div class="ipet-bodies">
      <div class="ipet-body" id="ipet-tab-reminders"></div>
      <div class="ipet-body hidden" id="ipet-tab-agent"></div>
      <div class="ipet-body hidden" id="ipet-tab-pet"></div>
    </div>
  </div>`);
  document.body.appendChild(panel);

  const gear = document.getElementById('ipet-gear')!;
  gear.onclick = () => {
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) void renderReminders();
  };
  document.getElementById('ipet-settings-close')!.onclick = () => panel.classList.add('hidden');

  panel.querySelectorAll('.ipet-seg button[data-tab]').forEach((b) => {
    (b as HTMLElement).onclick = () => {
      panel.querySelectorAll('.ipet-seg button[data-tab]').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      const tab = (b as HTMLElement).dataset.tab!;
      panel.querySelectorAll('.ipet-body').forEach((x) => x.classList.add('hidden'));
      document.getElementById(`ipet-tab-${tab}`)!.classList.remove('hidden');
      if (tab === 'reminders') void renderReminders();
      if (tab === 'pet') void refreshPetTab();
    };
  });

  buildRemindersTab();
  buildAgentTab();
  buildPetTab(onMood);
  // 番茄钟时钟:宠物 tab 可见时每秒刷新
  window.setInterval(() => {
    const petTab = document.getElementById('ipet-tab-pet');
    if (petTab && !petTab.classList.contains('hidden')) void refreshPomo();
  }, 1000);
}

/* ================= 提醒 tab ================= */

interface ReminderDto {
  id: string; name: string; kind: string; cron_expr: string;
  message: string; level: string; enabled: boolean;
}

function buildRemindersTab(): void {
  const root = document.getElementById('ipet-tab-reminders')!;
  root.innerHTML = `
    <div class="card hero">
      <div class="card-title">✨ 智能添加</div>
      <div class="card-sub">直接说中文，比如"每45分钟提醒我喝水"</div>
      <div class="hero-row">
        <input id="rem-natural" placeholder="每45分钟提醒我喝水" />
        <button id="rem-natural-add" class="btn-primary">添加</button>
      </div>
    </div>
    <div class="card">
      <div class="card-head">
        <div class="card-title">我的提醒</div>
        <button id="rem-refresh" class="btn-ghost">↻ 刷新</button>
      </div>
      <div id="rem-list" class="stack"></div>
    </div>
    <details class="card">
      <summary>＋ 手动添加（cron 表达式）</summary>
      <div class="form">
        <input id="rem-name" placeholder="名称，如：喝水" />
        <div class="form-row">
          <select id="rem-kind">
            <option value="water">💧 喝水</option>
            <option value="eye_rest">👀 远眺</option>
            <option value="break">☕ 休息</option>
            <option value="custom">✨ 自定义</option>
          </select>
          <select id="rem-level">
            <option value="gentle">轻推</option>
            <option value="normal" selected>普通</option>
            <option value="strong">强提醒</option>
          </select>
        </div>
        <input id="rem-cron" placeholder="cron，如：0 */45 * * * *" />
        <input id="rem-msg" placeholder="提醒文案" />
        <button id="rem-add" class="btn-primary wide">添加提醒</button>
      </div>
    </details>`;

  const v = (id: string) => (document.getElementById(id) as HTMLInputElement).value.trim();
  (document.getElementById('rem-refresh') as HTMLElement).onclick = () => void renderReminders();
  (document.getElementById('rem-natural-add') as HTMLElement).onclick = async () => {
    const text = v('rem-natural');
    if (!text) { toast('先说一句提醒内容吧'); return; }
    try {
      await tauriInvoke('add_reminder_natural', { text });
      (document.getElementById('rem-natural') as HTMLInputElement).value = '';
      toast('已添加 ✅'); void renderReminders();
    } catch (e: unknown) { toast('失败：' + (e as Error).message); }
  };
  (document.getElementById('rem-add') as HTMLElement).onclick = async () => {
    try {
      await tauriInvoke('add_reminder', {
        name: v('rem-name') || '自定义提醒',
        kind: (document.getElementById('rem-kind') as HTMLSelectElement).value,
        cron_expr: v('rem-cron'),
        message: v('rem-msg') || '提醒时间到',
        level: (document.getElementById('rem-level') as HTMLSelectElement).value,
      });
      toast('已添加 ✅'); void renderReminders();
    } catch (e: unknown) { toast('失败：' + (e as Error).message); }
  };
}

async function renderReminders(): Promise<void> {
  const list = document.getElementById('rem-list');
  if (!list) return;
  try {
    const items = await tauriInvoke<ReminderDto[]>('list_reminders');
    list.innerHTML = '';
    if (!items.length) {
      list.appendChild(el(`<div class="empty">还没有提醒，去上面智能添加一条吧 👆</div>`));
      return;
    }
    for (const r of items) {
      const lv = LEVEL_META[r.level] ?? { label: r.level, cls: 'lv-normal' };
      const row = el(`<div class="rem-row">
        <div class="rem-main">
          <div class="rem-name">${esc(r.name)} <span class="pill ${lv.cls}">${lv.label}</span></div>
          <div class="rem-meta">${esc(KIND_LABEL[r.kind] ?? r.kind)} · <code>${esc(r.cron_expr)}</code></div>
        </div>
      </div>`);
      const sw = switchEl(r.enabled, async (en) => {
        try { await tauriInvoke('set_reminder_enabled', { id: r.id, enabled: en }); }
        catch (e: unknown) { toast('失败：' + (e as Error).message); void renderReminders(); }
      });
      const del = el(`<button class="icon-btn danger" title="删除">🗑</button>`) as HTMLButtonElement;
      del.onclick = async () => {
        try { await tauriInvoke('remove_reminder', { id: r.id }); toast('已删除'); void renderReminders(); }
        catch (e: unknown) { toast('失败：' + (e as Error).message); }
      };
      const ctl = el(`<div class="rem-ctl"></div>`);
      ctl.appendChild(sw); ctl.appendChild(del);
      row.appendChild(ctl);
      list.appendChild(row);
    }
  } catch {
    list.innerHTML = `<div class="empty">非 Tauri 环境，无法读取提醒</div>`;
  }
}

/* ================= Agent tab ================= */

function buildAgentTab(): void {
  const root = document.getElementById('ipet-tab-agent')!;
  root.innerHTML = `
    <div class="card">
      <div class="card-title">🔌 注册本地 Agent</div>
      <div class="card-sub">把你本机的 MCP agent 接进来，宠物就能调用它的工具</div>
      <div class="form">
        <input id="ag-name" placeholder="名称，如：my-agent" />
        <input id="ag-cmd" placeholder="启动命令，如：npx" />
        <input id="ag-args" placeholder="参数（空格分隔）" />
        <input id="ag-persona" placeholder="人格/皮肤标识，如：assistant" />
        <button id="ag-register" class="btn-primary wide">注册</button>
      </div>
    </div>
    <div class="card">
      <div class="card-title">🔗 连接</div>
      <div class="hero-row">
        <input id="ag-conn-name" placeholder="agent 名称" />
        <button id="ag-connect" class="btn-primary">连接</button>
      </div>
      <div id="ag-tools" class="tip"></div>
    </div>
    <div class="card">
      <div class="card-title">🛠 调用 tool</div>
      <div class="form">
        <div class="form-row">
          <input id="ag-call-server" placeholder="agent 名称" />
          <input id="ag-call-tool" placeholder="tool 名称" />
        </div>
        <textarea id="ag-call-args" rows="2" placeholder='参数 JSON，如：{"text":"你好"}'></textarea>
        <button id="ag-call" class="btn-primary wide">调用</button>
      </div>
      <pre id="ag-result" class="pre hidden"></pre>
    </div>`;

  const tools = document.getElementById('ag-tools') as HTMLElement;
  const result = document.getElementById('ag-result') as HTMLElement;
  const v = (id: string) => (document.getElementById(id) as HTMLInputElement).value.trim();

  (document.getElementById('ag-register') as HTMLElement).onclick = async () => {
    if (!v('ag-name') || !v('ag-cmd')) { toast('名称和启动命令必填'); return; }
    try {
      await tauriInvoke('agent_register', {
        name: v('ag-name'), command: v('ag-cmd'),
        args: v('ag-args') ? v('ag-args').split(/\s+/) : [],
        persona: v('ag-persona'),
      });
      toast('已注册 ✅');
    } catch (e: unknown) { toast('失败：' + (e as Error).message); }
  };
  (document.getElementById('ag-connect') as HTMLElement).onclick = async () => {
    try {
      const list = await tauriInvoke<string[]>('agent_connect', { name: v('ag-conn-name') });
      tools.textContent = '可用 tools：' + (list.length ? list.join('、') : '（无）');
      toast('连接成功 ✅');
    } catch (e: unknown) { tools.textContent = '失败：' + (e as Error).message; }
  };
  (document.getElementById('ag-call') as HTMLElement).onclick = async () => {
    try {
      const argsText = (document.getElementById('ag-call-args') as HTMLTextAreaElement).value.trim();
      const out = await tauriInvoke<string>('agent_call_tool', {
        server: v('ag-call-server'), tool: v('ag-call-tool'),
        args: argsText ? JSON.parse(argsText) : {},
      });
      result.textContent = out;
      result.classList.remove('hidden');
    } catch (e: unknown) {
      result.textContent = '失败：' + (e as Error).message;
      result.classList.remove('hidden');
    }
  };
}

/* ================= 宠物 tab ================= */

function buildPetTab(onMood: (m: string) => void): void {
  const root = document.getElementById('ipet-tab-pet')!;
  const voiceOn = localStorage.getItem('ipet_voice') !== 'off';
  root.innerHTML = `
    <div class="card affection">
      <div class="aff-top">
        <div class="aff-emoji" id="aff-emoji">🙂</div>
        <div class="aff-info">
          <div class="aff-score"><span id="aff-num">--</span><small> / 100</small></div>
          <div class="aff-mood" id="aff-mood">好感度</div>
        </div>
        <button id="pet-pat" class="btn-primary">🤲 摸摸头</button>
      </div>
      <div class="bar"><div class="bar-fill" id="aff-bar"></div></div>
      <div class="card-sub" id="aff-today">今日互动 -- 次 · 多陪陪它会更开心</div>
    </div>
    <div class="card">
      <div class="card-head">
        <div class="card-title">🍅 番茄钟</div>
        <span class="pill" id="pomo-phase">未开始</span>
      </div>
      <div class="pomo-time" id="pomo-time">25:00</div>
      <div class="btn-row">
        <button id="pomo-start" class="btn-primary">开始专注</button>
        <button id="pomo-skip" class="btn-ghost">跳过</button>
        <button id="pomo-stop" class="btn-ghost">停止</button>
      </div>
      <div class="card-sub" id="pomo-cycles">已完成 0 轮 · 25 分钟专注 / 5 分钟休息</div>
    </div>
    <div class="card">
      <div class="card-title">⚙️ 偏好</div>
      <div class="pref-list" id="pref-list"></div>
      <div class="pref-row">
        <span>语言 <span class="pref-sub">Language</span></span>
        <div class="seg small">
          <button data-lang="zh" class="active">中文</button>
          <button data-lang="en">EN</button>
        </div>
      </div>
    </div>`;

  const prefs = document.getElementById('pref-list')!;
  const mkPref = (label: string, sub: string, initial: boolean, onChange: (v: boolean) => void) => {
    const row = el(`<div class="pref-row"><span>${label}<span class="pref-sub">${sub}</span></span></div>`);
    row.appendChild(switchEl(initial, onChange));
    prefs.appendChild(row);
  };
  mkPref('点击穿透', '专注时鼠标穿过宠物', false, async (en) => {
    try { await tauriInvoke('set_click_through', { ignore: en }); }
    catch { toast('切换失败'); }
  });
  mkPref('语音播报', '强提醒时读出内容', voiceOn, (en) => {
    localStorage.setItem('ipet_voice', en ? 'on' : 'off');
    toast(en ? '语音播报已开启' : '语音播报已关闭');
  });

  root.querySelectorAll('.seg.small button').forEach((b) => {
    (b as HTMLElement).onclick = async () => {
      root.querySelectorAll('.seg.small button').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      try { await tauriInvoke('set_language', { lang: (b as HTMLElement).dataset.lang! }); toast('已切换'); }
      catch { /* 非 Tauri 环境忽略 */ }
    };
  });

  (document.getElementById('pet-pat') as HTMLElement).onclick = async () => {
    try {
      const mood = await tauriInvoke<string>('affection_interact', { kind: 'pet' });
      onMood(mood); void refreshAffection(); toast('它很开心 ❤️');
    } catch { /* ignore */ }
  };
  const pomoAct = (cmd: string) => async () => {
    try { await tauriInvoke(cmd); void refreshPomo(); } catch { /* ignore */ }
  };
  (document.getElementById('pomo-start') as HTMLElement).onclick = pomoAct('pomodoro_start');
  (document.getElementById('pomo-skip') as HTMLElement).onclick = pomoAct('pomodoro_skip');
  (document.getElementById('pomo-stop') as HTMLElement).onclick = pomoAct('pomodoro_stop');
}

async function refreshAffection(): Promise<void> {
  const num = document.getElementById('aff-num');
  if (!num) return;
  try {
    const a = await tauriInvoke<{ score: number; mood: string; interactions_today: number }>('affection_get');
    num.textContent = String(Math.round(a.score));
    (document.getElementById('aff-emoji') as HTMLElement).textContent = AFF_EMOJI[a.mood] ?? '🙂';
    (document.getElementById('aff-mood') as HTMLElement).textContent = AFF_LABEL[a.mood] ?? a.mood;
    (document.getElementById('aff-bar') as HTMLElement).style.width = `${Math.round(a.score)}%`;
    (document.getElementById('aff-today') as HTMLElement).textContent =
      `今日互动 ${a.interactions_today} 次 · 多陪陪它会更开心`;
  } catch { /* 非 Tauri 环境 */ }
}

const POMO_PHASE_LABEL: Record<string, string> = {
  idle: '未开始', focus: '专注中', short_break: '短休息', long_break: '长休息',
};

async function refreshPomo(): Promise<void> {
  const time = document.getElementById('pomo-time');
  if (!time) return;
  try {
    const s = await tauriInvoke<{ phase: string; remaining_secs: number; completed_cycles: number }>('pomodoro_status');
    const mm = Math.floor(s.remaining_secs / 60);
    const ss = String(s.remaining_secs % 60).padStart(2, '0');
    time.textContent = `${mm}:${ss}`;
    const phaseEl = document.getElementById('pomo-phase') as HTMLElement;
    phaseEl.textContent = POMO_PHASE_LABEL[s.phase] ?? s.phase;
    phaseEl.className = 'pill ' + (s.phase === 'focus' ? 'lv-strong' : s.phase === 'idle' ? '' : 'lv-normal');
    (document.getElementById('pomo-cycles') as HTMLElement).textContent =
      `已完成 ${s.completed_cycles} 轮 · 25 分钟专注 / 5 分钟休息`;
  } catch { /* 非 Tauri 环境 */ }
}

async function refreshPetTab(): Promise<void> {
  await refreshAffection();
  await refreshPomo();
}
