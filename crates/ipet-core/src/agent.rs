use rmcp::model::ContentBlock;
use rmcp::model::CallToolRequestParams;
use rmcp::transport::{ConfigureCommandExt, TokioChildProcess};
use rmcp::{RoleClient, ServiceExt};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::process::Command;
use tokio::sync::RwLock;

/// 用户本地安装的一个智能 agent(MCP server)。
/// 通过 stdio 子进程方式接入:ipet 拉起 `command + args` 进程并完成 MCP 握手。
/// 这意味着任何支持 MCP 的 agent(Claude Code、本地 MCP server 等)都能被宠物调用。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerConfig {
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    /// 该 agent 对应的人格/皮肤,例如 "assistant" / "lazy_cat"
    #[serde(default)]
    pub persona: String,
}

/// Agent 桥接:管理多个 MCP agent 的连接与 tool 调用。
/// 典型用途:agent 跑完长任务后,宠物把结果"走过来"播报给用户。
pub struct AgentBridge {
    configs: Arc<RwLock<HashMap<String, McpServerConfig>>>,
    clients: Arc<RwLock<HashMap<String, rmcp::service::RunningService<RoleClient, ()>>>>,
}

impl AgentBridge {
    pub fn new(configs: Vec<McpServerConfig>) -> Self {
        let map = configs
            .into_iter()
            .map(|c| (c.name.clone(), c))
            .collect();
        Self {
            configs: Arc::new(RwLock::new(map)),
            clients: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn register(&self, cfg: McpServerConfig) {
        self.configs
            .write()
            .await
            .insert(cfg.name.clone(), cfg);
    }

    pub async fn servers(&self) -> Vec<McpServerConfig> {
        self.configs.read().await.values().cloned().collect()
    }

    pub async fn connected(&self) -> Vec<String> {
        self.clients.read().await.keys().cloned().collect()
    }

    /// 连接指定 agent:拉起子进程、完成 MCP 握手,返回其 tool 列表
    pub async fn connect(&self, name: &str) -> Result<Vec<String>, String> {
        let cfg = self
            .configs
            .read()
            .await
            .get(name)
            .cloned()
            .ok_or_else(|| format!("未找到 agent 配置: {name}"))?;
        let mut cmd = Command::new(&cfg.command);
        cmd.args(&cfg.args);
        let transport = TokioChildProcess::new(cmd.configure(|c| {
            c.kill_on_drop(true);
        }))
        .map_err(|e| format!("启动 agent 进程失败: {e}"))?;
        let client = ().serve(transport).await.map_err(|e| format!("MCP 握手失败: {e}"))?;
        let tools = client
            .list_tools(None)
            .await
            .map_err(|e| format!("列出 tools 失败: {e}"))?;
        let names: Vec<String> = tools.tools.iter().map(|t| t.name.to_string()).collect();
        self.clients.write().await.insert(name.to_string(), client);
        Ok(names)
    }

    /// 调用已连接 agent 的某个 tool,返回文本结果
    pub async fn call_tool(
        &self,
        server: &str,
        tool: &str,
        args: serde_json::Value,
    ) -> Result<String, String> {
        let clients = self.clients.read().await;
        let client = clients
            .get(server)
            .ok_or_else(|| format!("agent 未连接: {server},请先调用 connect"))?;
        let arguments = args.as_object().cloned().unwrap_or_default();
        let req = CallToolRequestParams::new(tool.to_string()).with_arguments(arguments);
        let result = client
            .call_tool(req)
            .await
            .map_err(|e| format!("调用 tool 失败: {e}"))?;
        let mut out = String::new();
        for content in result.content {
            match content {
                ContentBlock::Text(t) => {
                    out.push_str(&t.text);
                    out.push('\n');
                }
                _ => out.push_str("[非文本内容,已省略]\n"),
            }
        }
        if result.is_error.unwrap_or(false) {
            return Err(out);
        }
        Ok(out)
    }

    pub async fn disconnect(&self, name: &str) -> bool {
        self.clients.write().await.remove(name).is_some()
    }
}
