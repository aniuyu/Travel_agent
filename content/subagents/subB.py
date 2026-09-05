from conn.llm import get_llm
from langchain.tools import tool

@ tool
def get_random_number():
    """
    获取随机数
    :return: 随机数
    """
    print("获取随机数")

    # 实际上必然获取固定值，以此代表走到了该方法，为方便测试，否则不知道是该方法产生的随机数还是LLM自己产生的随机数
    return 8

def get_agent():
    return {
        "name": "random-number-agent",
        "description": "获取随机数的助手",
        "system_prompt": f"你是一个获取随机数的助手",
        "tools": [get_random_number],
        "model": get_llm(),
    } # 可定义更多，字典中的key对应create_deep_agent时的参数 + name + description