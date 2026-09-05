from deepagents import create_deep_agent
from conn.llm import get_llm
from deepagents.backends import FilesystemBackend

agent = create_deep_agent(
    model=get_llm(),
    tools=[],
    system_prompt="",
    skills = ["/skills"],
    backend=FilesystemBackend(root_dir="/agent_files", virtual_mode=True)
)

for chunk in agent.stream({"messages":[{"role":"user","content":"用技能计算3+2"}]}):
    print(chunk)