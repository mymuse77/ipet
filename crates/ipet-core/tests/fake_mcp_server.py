#!/usr/bin/env python3
"""Fake MCP server for ipet-core integration tests.

Minimal JSON-RPC over stdio (newline-delimited), implementing just enough of
the MCP protocol for the AgentBridge test: initialize, notifications/initialized,
tools/list, tools/call, ping.
"""
import sys
import json
import datetime


def send(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        mid = msg.get("id")
        method = msg.get("method")
        params = msg.get("params", {}) or {}

        if method == "initialize":
            send({
                "jsonrpc": "2.0",
                "id": mid,
                "result": {
                    # echo the client's protocol version: standard negotiation
                    "protocolVersion": params.get("protocolVersion", "2025-11-25"),
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "fake-ipet-agent", "version": "0.1.0"},
                },
            })
        elif method == "notifications/initialized":
            pass  # notification: no response
        elif method == "tools/list":
            send({
                "jsonrpc": "2.0",
                "id": mid,
                "result": {
                    "tools": [
                        {
                            "name": "get_time",
                            "description": "返回当前时间",
                            "inputSchema": {"type": "object", "properties": {}},
                        },
                        {
                            "name": "echo",
                            "description": "复述文本",
                            "inputSchema": {
                                "type": "object",
                                "properties": {"text": {"type": "string"}},
                                "required": ["text"],
                            },
                        },
                    ]
                },
            })
        elif method == "tools/call":
            name = params.get("name")
            args = params.get("arguments", {}) or {}
            if name == "get_time":
                text = "现在是 " + datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            elif name == "echo":
                text = "宠物复述:" + str(args.get("text", ""))
            else:
                text = "未知工具:" + str(name)
            send({
                "jsonrpc": "2.0",
                "id": mid,
                "result": {"content": [{"type": "text", "text": text}]},
            })
        elif method == "ping":
            send({"jsonrpc": "2.0", "id": mid, "result": {}})
        # unknown methods are ignored


if __name__ == "__main__":
    main()
