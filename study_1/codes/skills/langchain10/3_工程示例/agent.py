from deepagents import create_deep_agent
from deepagents.backends import FilesystemBackend
from excute_middle import ExecuteMiddle
import excute_middle
from langchain_openai import ChatOpenAI

def get_llm():
    llm = ChatOpenAI(base_url='https://api.siliconflow.cn/v1',
                     model='Qwen/Qwen3.5-122B-A10B')
    return llm


agent = create_deep_agent(
    model=get_llm(),
    system_prompt="",
    middleware=[ExecuteMiddle()],
    skills = ["/skills"],
    backend=FilesystemBackend(root_dir=excute_middle.ROOT_PATH_AGENT, virtual_mode=True)
)

for chunk in agent.stream({"messages":[{"role":"user","content":"用技能告诉现在几点"}]}):
    print(chunk)


# 1. 默认deep_agent没有终端工具，所以无法调用脚本
# 2. 路径问题
