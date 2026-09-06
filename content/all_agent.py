import sys, os
import asyncio
# 将项目根目录加入sys.path，确保直接运行时模块导入正常
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from deepagents import create_deep_agent
from conn.llm import get_llm
from base import config as cfg
from content.others import mybackend
#from content.others import mybackend_easy
from content.mytools import globle_tools as gt,read_doc_tools as rdt,write_doc_tools as wdt
from content.mytools import vlm_tool,gen_image
from content.middles.file_manager_middle import FileManagerMiddleware
from content.middles.minio_middle import MinioMiddle
from content.middles.wait_rate_limit import wait_rate_limit
from content.middles.excute_middle import ExcuteMiddleware
from content.middles import my_skill_middle
from content.mcps import travily_search
if cfg.USE_EXCEL:
    from content.subagents import excel_agent
if cfg.USE_PPT:
    from content.subagents import ppt_agent
if cfg.USE_TRAVEL:
    from content.subagents import travel_agent, itinerary_agent

class AllAgent():

    def __init__(self):
        prompt = f'''
         你是一个通用智能体，
         要执行终端命令操作，则使用execute工具，
         搜新闻时先用工具确认一下今天是哪天。
         读取ppt,doc,xls,pdf等文件时优先使用get_file_content,
         做图文需求时,如无特殊说明，则先做md,然后转换为pdf,要特别注意图片引用路径。
         渲染图片时必须用 Markdown 语法 ![](url)，不要只给链接文字或说"无法显示"。
         直到完成任务前，都不要停止。
         回答用户用中文。
         '''
        if cfg.USE_EXCEL:
            prompt+='\n制作Excel的需求，优先使用子代理中的excel-agent。'
        if cfg.USE_PPT:
            prompt+='\n制作PPT的需求，优先使用子代理中的ppt-agent。注意：ppt-agent不是工具的名字，它是子智能体的名字，调工具应该是调用名为task的工具。'
        if cfg.USE_TRAVEL:
            prompt+='\n旅游出行相关需求，请按「短途差旅」流程处理：'
            prompt+='\n  1) 需求澄清：先确认目的地、日期、人数、预算、主题等关键信息，缺什么问什么。'
            prompt+='\n  2) 单点查询（只查机票 / 只查火车票/高铁票 / 只查酒店 / 只查天气）：交给子代理 travel-agent。'
            prompt+='\n  3) 查看某个具体酒店/航班/车次的图片或详情（含"看 X 酒店的图片"）：交给子代理 travel-agent，由它调用真实数据工具拿带图片 URL 的结果，绝不要用 tavily_search 去搜网络图片。'
            prompt+='\n  3.5) 地图/路线/导航需求（如"从南京到上海怎么走""自驾路线""XX 在地图上标出来"）：交给子代理 travel-agent，由它调 geocode + build_map 生成高德地图。绝不要自己用文字描述路线。'
            prompt+='\n  4) 完整行程规划（机票/火车票+酒店+天气+行程单）：交给子代理 itinerary-agent。'
            prompt+='\n  5) 方案比选：由子代理给出「最便宜/最快/性价比」推荐。'
            prompt+='\n  6) 预订：用户确认后，用 book_flight / book_train / book_hotel 完成预订（演示）。'
            prompt+='\n  7) 行程单：由 itinerary-agent 依据 itinerary-generator 技能生成结构化行程单。'
            prompt+='\n注意：'
            prompt+='\n  - 不要自己用搜索工具（tavily）去查航班/火车票/酒店/天气/酒店图片，必须交给上述子代理。'
            prompt+='\n  - tavily_search 仅用于：通用新闻/资讯查询、查不熟悉的主题知识这类非旅游场景。'
            prompt+='\n  - 子代理返回的 ```map-json 代码块（高德地图数据）必须【原样、完整】转发给用户，不要改写、不要省略、不要用文字描述路线去替代它；地图代码块必须出现在最终回复里。'

        self.agent = create_deep_agent(
            model=get_llm(), # 模型, 传一个llm实例
            tools=self._get_tools(), # 工具集
            system_prompt=prompt, # 系统提示词
            backend=mybackend.backend_factory,
            middleware=self._get_middles(),
            subagents = self._get_subagents()
        )

    def _get_middles(self):
        middles = [FileManagerMiddleware(), wait_rate_limit, MinioMiddle(), ExcuteMiddleware()]
        # middles.append(my_skill_middle.MySkillsMiddleware(backend=mybackend.backend_factory, sources=[cfg.SKILL_DIR_PATH]))
        return middles


    def _get_tools(self):
        tools = [gt.get_current_time, rdt.get_file_content, wdt.convert_file]
        tools.append(vlm_tool.read_image)
        tools.append(gen_image.generate_image)
        if cfg.TAVILY_SEARCH_KEY: # 是否存在TAVILY_SEARCH_KEY来开关这个功能
            tools.extend(travily_search.get_tools())
        return tools

    def _get_subagents(self):
        subagent = []
        if cfg.USE_EXCEL:
            subagent.append(excel_agent.get_agent())
        if cfg.USE_PPT:
            subagent.append(ppt_agent.get_agent())
        if cfg.USE_TRAVEL:
            subagent.append(travel_agent.get_agent())
            subagent.append(itinerary_agent.get_agent())
        return subagent








if __name__ == '__main__':
    agent = AllAgent().agent
    # from utils.langchain_utils.common_utils import save_graph_img
    # save_graph_img(agent, "all_agent.png")
    from utils.langchain_utils import stream_util as su
    m = su.Memery()
    # 控制台agent聊天工具，控制台只输出AI的回复。日志文件里记录Agent
    async def main():
      # 控制台agent聊天工具，控制台只输出AI的回复。日志文件里记录Agent
      while True:
        user_input = input("用户：")
        await m.stream_both_with_memory(agent, user_input)
        print()


    asyncio.run(main())


