//! Agent 桥接端到端测试:用一个最小的假 MCP server(Python stdio)
//! 验证 connect(拉起子进程+MCP 握手+列 tools)与 call_tool 全链路可用。

use ipet_core::{AgentBridge, McpServerConfig};

fn fake_server() -> McpServerConfig {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fake_mcp_server.py");
    McpServerConfig {
        name: "fake-agent".to_string(),
        command: "python3".to_string(),
        args: vec![path.to_string()],
        persona: "assistant".to_string(),
    }
}

#[tokio::test]
async fn agent_connect_lists_tools() {
    let bridge = AgentBridge::new(vec![fake_server()]);
    let tools = bridge.connect("fake-agent").await.expect("MCP connect 失败");
    assert!(tools.contains(&"get_time".to_string()), "tools: {tools:?}");
    assert!(tools.contains(&"echo".to_string()), "tools: {tools:?}");
    assert_eq!(bridge.connected().await, vec!["fake-agent".to_string()]);
}

#[tokio::test]
async fn agent_call_tool_roundtrip() {
    let bridge = AgentBridge::new(vec![fake_server()]);
    bridge.connect("fake-agent").await.expect("MCP connect 失败");

    let out = bridge
        .call_tool("fake-agent", "get_time", serde_json::json!({}))
        .await
        .expect("call_tool 失败");
    assert!(out.contains("现在是"), "unexpected output: {out}");

    let out = bridge
        .call_tool("fake-agent", "echo", serde_json::json!({"text": "你好"}))
        .await
        .expect("call_tool 失败");
    assert!(out.contains("宠物复述:你好"), "unexpected output: {out}");

    assert!(bridge.disconnect("fake-agent").await);
    assert!(bridge.connected().await.is_empty());
}

#[tokio::test]
async fn agent_unknown_server_errors() {
    let bridge = AgentBridge::new(vec![]);
    assert!(bridge.connect("ghost").await.is_err());
    assert!(bridge
        .call_tool("ghost", "whatever", serde_json::json!({}))
        .await
        .is_err());
}
