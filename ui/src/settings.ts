/**
 * ipet 设置面板
 *
 * 三个 tab:
 * - 提醒:列表 / 开关 / 删除 / 添加（表单 + cron + 中文自然语言）
 * - Agent:注册本地 MCP agent / 连接 / 调用 tool
 * - 宠物:亲密度与摸摸头 / 番茄钟 / 点击穿透 / 语音播报 / 语言
 *
 * 非 Tauri 环境（浏览器直接打开预览）下所有操作给出提示，不抛错。
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

const KIND_LABEL: Record<string, string> = {
  water: '喝水', eye_rest: '远眺', break: '休息', custom: '自定义',
};
const LEVEL_LABEL: Record<string, string> = {
  gentle: '轻推', normal: '普通', strong: '强提醒',
};

export function initSettings(onMood: (mood: string) => void): void {
  document.body.appendChild(el(`<button id="ipet-gear" title="设置">⚙</button>`));
  const panel = el(`
    <div id="ipet-settings" class="hidden">
      <div class="ipet-tabs">
        <button data-tab="reminders" class="active">提醒</button>
        <button data-tab="agent">Agent</button>
        <button data-tab="pet">宠物</button>
        <button id="ipet-settings-close" title="关闭">✕</button>
      </div>
      <div class="ipet-tab-body" id="ipet-tab-reminders"></div>
      <div class="ipet-tab-body hidden" id="ipet-tab-agent"></div>
      <div class="ipet-tab-body hidden" id="ipet-tab-pet"></div>
    </div>`);
  document.body.appendChild(panel);

  const gear = document.getElementById('ipet-gear')!;
  gear.onclick = () => {
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) renderReminders();
  };
  document.getElementById('ipet-settings-close')!.onclick = () => panel.classList.add('hidden');
  panel.querySelectorAll('.ipet-tabs button[data-tab]').forEach((b) => {
    (b as HTMLElement).onclick = () => {
      panel.querySelectorAll('.ipet-tabs button[data-tab]').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      const tab = (b as HTMLElement).dataset.tab!;
      panel.querySelectorAll('.ipet-tab-body').forEach((x) => x.classList.add('hidden'));
      document.getElementById(`ipet-tab-${tab}`)!.classList.remove('hidden');
      if (tab === 'reminders') renderReminders();
      if (tab === 'agent') renderAgent();
      if (tab === 'pet') renderPet();
    };
  });

  buildRemindersTab(onMood);
  buildAgentTab();
  buildPetTab(onMood);
}

/* ---------------- 提醒 tab ---------------- */

function buildRemindersTab(_onMood: (m: string) => void): void {
  const root = document.getElementById('ipet-tab-reminders')!;
  root.innerHTML = `
    <div class="ipet-row"><strong>提醒列表</strong><button id="rem-refresh">刷新</button></div>
    <div id="rem-list" class="ipet-list"></div>
    <div class="ipet-row"><strong>添加提醒</strong></div>
    <input id="rem-name" placeholder="名称，如：喝水" />
    <div class="ipet-row2">
      <select id="rem-kind">
        <option value="water">喝水</option>
        <option value="eye_rest">远眺</option>
        <option value="break">休息</option>
        <option value="custom">自定义</option>
      </select>
      <select id="rem-level">
        <option value="gentle">轻推</option>
        <option value="normal" selected>普通</option>
        <option value="strong">强提醒</option>
      </select>
    </div>
    <input id="rem-cron" placeholder="cron，如：0 */45 * * * *" />
    <input id="rem-msg" placeholder="提醒文案" />
    <button id="rem-add" class="primary">添加</button>
    <div class="ipet-row"><strong>智能添加</strong></div>
    <input id="rem-natural" placeholder="每45分钟提醒我喝水" />
    <button id="rem-natural-add" class="primary">智能添加</button>
    <div id="rem-tip" class="ipet-tip"></div>`;

  const tip = (m: string) => { (document.getElementById('rem-tip') as HTMLElement).textContent = m; };
  (document.getElementById('rem-refresh') as HTMLElement).onclick = () => renderReminders();
  (document.getElementById('rem-add') as HTMLElement).onclick = async () => {
    const v = (id: string) => (document.getElementById(id) as HTMLInputElement).value.trim();
    try {
      await tauriInvoke('add_reminder', {
        name: v('rem-name') || '自定义提醒',
        kind: (document.getElementById('rem-kind') as HTMLSelectElement).value,
        cron_expr: v('rem-cron'),
        message: v('rem-msg') || '提醒时间到',
        level: (document.getElementById('rem-level') as HTMLSelectElement).value,
      });
      tip('已添加'); renderReminders();
    } catch (e: unknown) { tip('失败：' + (e as Error).message); }
  };
  (document.getElementById('rem-natural-add') as HTMLElement).onclick = async () => {
    const text = (document.getElementById('rem-natural') as HTMLInputElement).value.trim();
    try {
      await tauriInvoke('add_reminder_natural', { text });
      tip('已添加'); renderReminders();
    } catch (e: unknown) { tip('失败：' + (e as Error).message); }
  };
}

interface ReminderDto {
  id: string; name: string; kind: string; cron_expr: string;
  message: string; level: string; enabled: boolean;
}

async function renderReminders(): Promise<void> {
  const list = document.getElementById('rem-list')!;
  try {
    const items = await tauriInvoke<ReminderDto[]>('list_reminders');
    list.innerHTML = '';
    if (!items.length) list.appendChild(el(`<div class="ipet-empty">暂无提醒</div>`));
    for (const r of items) {
      const row = el(`<div class="ipet-item">
        <input type="checkbox" ${r.enabled ? 'checked' : ''} title="启用" />
        <div class="ipet-item-main"><div>${esc(r.name)}</div>
        <div class="ipet-meta">${esc(KIND_LABEL[r.kind] ?? r.kind)} · ${esc(LEVEL_LABEL[r.level] ?? r.level)} · <code>${esc(r.cron_expr)}</code></div></div>
        <button class="danger" title="删除">删</button>
      </div>`);
      const [box, del] = [row.querySelector('input')!, row.querySelector('button')!];
      box.onchange = async () => {
        try { await tauriInvoke('set_reminder_enabled', { id: r.id, enabled: box.checked }); }
        catch { box.checked = !box.checked; }
      };
      del.onclick = async () => {
        try { await tauriInvoke('remove_reminder', { id: r.id }); renderReminders(); } catch { /* ignore */ }
      };
      list.appendChild(row);
    }
  } catch {
    list.innerHTML = `<div class="ipet-empty">非 Tauri 环境，无法读取提醒</div>`;
  }
}

/* ---------------- Agent tab ---------------- */

function buildAgentTab(): void {
  const root = document.getElementById('ipet-tab-agent')!;
  root.innerHTML = `
    <div class="ipet-row"><strong>注册本地 Agent</strong></div>
    <input id="ag-name" placeholder="名称，如：my-agent" />
    <input id="ag-cmd" placeholder="启动命令，如：npx" />
    <input id="ag-args" placeholder="参数（空格分隔），如：-y @modelcontextprotocol/server-filesystem /data" />
    <input id="ag-persona" placeholder="人格/皮肤标识，如：assistant" />
    <button id="ag-register" class="primary">注册</button>
    <div class="ipet-row"><strong>连接</strong></div>
    <div class="ipet-row2"><input id="ag-conn-name" placeholder="agent 名称" /><button id="ag-connect">连接</button></div>
    <div id="ag-tools" class="ipet-tip"></div>
    <div class="ipet-row"><strong>调用 tool</strong></div>
    <input id="ag-call-server" placeholder="agent 名称" />
    <input id="ag-call-tool" placeholder="tool 名称" />
    <textarea id="ag-call-args" rows="2" placeholder='参数 JSON，如：{"text":"你好"}'></textarea>
    <button id="ag-call" class="primary">调用</button>
    <pre id="ag-result" class="ipet-pre"></pre>`;

  const tools = document.getElementById('ag-tools') as HTMLElement;
  const result = document.getElementById('ag-result') as HTMLElement;
  const v = (id: string) => (document.getElementById(id) as HTMLInputElement).value.trim();

  (document.getElementById('ag-register') as HTMLElement).onclick = async () => {
    try {
      await tauriInvoke('agent_register', {
        name: v('ag-name'), command: v('ag-cmd'),
        args: v('ag-args') ? v('ag-args').split(/\s+/) : [],
        persona: v('ag-persona'),
      });
      tools.textContent = '已注册';
    } catch (e: unknown) { tools.textContent = '失败：' + (e as Error).message; }
  };
  (document.getElementById('ag-connect') as HTMLElement).onclick = async () => {
    try {
      const list = await tauriInvoke<string[]>('agent_connect', { name: v('ag-conn-name') });
      tools.textContent = '可用 tools：' + (list.length ? list.join('、') : '（无）');
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
    } catch (e: unknown) { result.textContent = '失败：' + (e as Error).message; }
  };
}

async function renderAgent(): Promise<void> { /* 按需刷新时扩展 */ }

/* ---------------- 宠物 tab ---------------- */

function buildPetTab(onMood: (m: string) => void): void {
  const root = document.getElementById('ipet-tab-pet')!;
  const voiceOn = localStorage.getItem('ipet_voice') !== 'off';
  root.innerHTML = `
    <div class="ipet-row"><strong>亲密度</strong><button id="pet-refresh">刷新</button></div>
    <div id="pet-affection" class="ipet-tip">--</div>
    <button id="pet-pat" class="primary">🤲 摸摸头</button>
    <div class="ipet-row"><strong>番茄钟</strong></div>
    <div id="pomo-status" class="ipet-tip">未开始</div>
    <div class="ipet-row2">
      <button id="pomo-start">开始</button>
      <button id="pomo-skip">跳过</button>
      <button id="pomo-stop">停止</button>
    </div>
    <div class="ipet-row"><strong>偏好</strong></div>
    <label class="ipet-check"><input type="checkbox" id="pet-clickthrough" /> 点击穿透（专注时鼠标穿过宠物）</label>
    <label class="ipet-check"><input type="checkbox" id="pet-voice" ${voiceOn ? 'checked' : ''} /> 强提醒语音播报</label>
    <div class="ipet-row2"><span>语言</span>
      <select id="pet-lang"><option value="zh">中文</option><option value="en">English</option></select>
    </div>`;

  const affEl = document.getElementById('pet-affection') as HTMLElement;
  const refreshAffection = async () => {
    try {
      const a = await tauriInvoke<{ score: number; mood: string; interactions_today: number }>('affection_get');
      affEl.textContent = `好感度 ${Math.round(a.score)} · ${a.mood} · 今日互动 ${a.interactions_today} 次`;
    } catch { affEl.textContent = '非 Tauri 环境'; }
  };
  (document.getElementById('pet-refresh') as HTMLElement).onclick = refreshAffection;
  (document.getElementById('pet-pat') as HTMLElement).onclick = async () => {
    try {
      const mood = await tauriInvoke<string>('affection_interact', { kind: 'pet' });
      onMood(mood); refreshAffection();
    } catch { /* ignore */ }
  };

  const pomoEl = document.getElementById('pomo-status') as HTMLElement;
  const refreshPomo = async () => {
    try {
      const s = await tauriInvoke<{ phase: string; remaining_secs: number; completed_cycles: number }>('pomodoro_status');
      const mm = Math.floor(s.remaining_secs / 60), ss = s.remaining_secs % 60;
      pomoEl.textContent = `${s.phase} · 剩余 ${mm}:${String(ss).padStart(2, '0')} · 已完成 ${s.completed_cycles} 轮`;
    } catch { pomoEl.textContent = '非 Tauri 环境'; }
  };
  const pomoAct = (cmd: string) => async () => {
    try { await tauriInvoke(cmd); refreshPomo(); } catch { /* ignore */ }
  };
  (document.getElementById('pomo-start') as HTMLElement).onclick = pomoAct('pomodoro_start');
  (document.getElementById('pomo-skip') as HTMLElement).onclick = pomoAct('pomodoro_skip');
  (document.getElementById('pomo-stop') as HTMLElement).onclick = pomoAct('pomodoro_stop');

  (document.getElementById('pet-clickthrough') as HTMLInputElement).onchange = async (e) => {
    try { await tauriInvoke('set_click_through', { ignore: (e.target as HTMLInputElement).checked }); }
    catch { (e.target as HTMLInputElement).checked = false; }
  };
  (document.getElementById('pet-voice') as HTMLInputElement).onchange = (e) => {
    localStorage.setItem('ipet_voice', (e.target as HTMLInputElement).checked ? 'on' : 'off');
  };
  (document.getElementById('pet-lang') as HTMLSelectElement).onchange = async (e) => {
    try { await tauriInvoke('set_language', { lang: (e.target as HTMLSelectElement).value }); }
    catch { /* ignore */ }
  };
  refreshAffection(); refreshPomo();
}

async function renderPet(): Promise<void> { /* 打开时已刷新 */ }
