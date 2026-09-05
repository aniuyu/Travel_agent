from conn.llm import get_llm
from deepagents import create_deep_agent
from langchain_mcp_adapters.client import MultiServerMCPClient
from deepagents.backends import FilesystemBackend
import os

# 1. 定义mcp服务地址
client = MultiServerMCPClient(
    {
        "excel": {
            "command": "uvx",
            "args": ["excel-mcp-server", "stdio"],
            "transport": "stdio",
        }
    }
)
import asyncio
# 2. 得到mcp提供工具
tools = asyncio.run(client.get_tools())
print(tools)

agent = create_deep_agent(
        get_llm(),
        tools=tools,
        backend=FilesystemBackend(root_dir='/agent_files',virtual_mode=True),
    )

async def run_agent():
    async for chunk in agent.astream({"messages": [{"role": "user", "content": "随便做个极简的excel示例"}]}):
        print(chunk)

import asyncio
asyncio.run(run_agent())