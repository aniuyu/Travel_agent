from conn.llm import get_llm
from langchain.agents import create_agent

from langchain_mcp_adapters.client import MultiServerMCPClient
import os


# 1. 定义mcp服务地址
client = MultiServerMCPClient(
    {
        "search": {
            "transport": "streamable_http",
            "url": f"https://mcp.tavily.com/mcp/?tavilyApiKey={os.getenv('TAVILY_SEARCH_KEY')}"
        }
    }
)
import asyncio
# 2. 得到mcp提供工具
tools = asyncio.run(client.get_tools())
print(tools)

agent = create_agent(
        get_llm(),
        tools=tools
    )
a = asyncio.run(agent.ainvoke({"messages": [{"role": "user", "content": "今日AI圈有什么新闻,今日是2026年8月30日"}]}))
print(a["messages"][-1].content)
