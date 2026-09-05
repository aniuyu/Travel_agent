# from langchain.agents.middleware import AgentMiddleware
# import subprocess
# import re,os
#
# root_dir = '/agent_files'
#
# def execute(command: str):
#     """
#     运行终端命令
#     :param command: 命令
#     :return: 运行结果
#     """
#     process = subprocess.Popen(command, shell=True,
#                                stdout=subprocess.PIPE,
#                                stderr=subprocess.PIPE,
#                                text= True,
#                                encoding='utf-8')
#     stdout, stderr = process.communicate()
#
#     s = f'''
#     正常输出：{stdout},
#     错误输出：{stderr}
#     '''
#     return s
#
# class ExcuteMiddleware(AgentMiddleware):
#     tools = [execute]
#     def wrap_tool_call(self,request,handler):
#         if request.tool_call['args'].get('command'): # 通过工具调用时是否存在command这个参数来判断，此时是不是在调用终端命令工具
#             request.tool_call['args']['command'] = self._change_command_path(request.tool_call['args']['command'])
#         return handler(request)
#
#     # 1. 用正则识别到路径字符串
#     def _find_path(self,text):
#         pattern = r'(?:[a-zA-Z]:)?[\\/](?:[^\\/:*?"<>|\s，。；：！？、,;:!?()\[\]{}]+[\\/])*[^\\/:*?"<>|\s，。；：！？、,;:!?()\[\]{}]+(?=[\s，。；：！？、,;:!?()\[\]{}]|$)'
#         paths = re.findall(pattern, text)
#         return paths
#
#     # 2. 在正则路径字符串替换为加上root_dir的字符串
#     def _change_command_path(self,command):
#         command = os.path.normpath(command)  # 规划化路径字符串
#         paths = self._find_path(command)  # 先找到路径字符串 /aaa/a.py
#         for p in paths:
#             rel_p = os.path.relpath(p, '/')
#             changed_path = os.path.join(root_dir, rel_p)  # 将路径字符串替换为加上root_dir的  /agent_files/aaa/a.py
#             command = command.replace(p, changed_path)  # 3. 最后把原来的命令字符串中的 路径字符串替换为 root_dir替换后的字符串
#         return os.path.normpath(command)  # 规划化路径字符串


import os.path
from langchain.agents.middleware import AgentMiddleware
import subprocess
import re
#from langchain.tools import tool

ROOT_PATH_AGENT = os.path.normpath('/agent_files')


def run_command(command: str):
    """
    运行终端命令
    :param command: 命令
    :return: 运行结果
    """
    process = subprocess.Popen(command, shell=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,text= True)
    stdout, stderr = process.communicate()
    s = f'''
    正常输出：{stdout},
    错误输出：{stderr}
    '''
    return s

class ExecuteMiddle(AgentMiddleware):
    tools = [run_command]

    def change_file_path(self,filepath):
        filepath = os.path.normpath(filepath)  # 规范化路径,把'\'给规范化成os.sep
        if ROOT_PATH_AGENT in filepath: # 如果路径本身就包含了根目录，则直接返回
            return filepath

        if os.path.isabs(filepath):  # isabs是判断这个路径是否是绝对路径，绝对路径的特征就是前面会有个/
            # relpath就是路径相对化，把绝对路径变成相对路径，其实也就是 去掉 start 的字符串
            filepath = os.path.relpath(filepath, start=os.sep)  # os.sep是一个规划话的分隔符 \
        p = os.path.join(ROOT_PATH_AGENT, filepath)
        return p

    def get_path_from_command(self, command):
        pattern = r'(?:[a-zA-Z]:)?[\\/]?(?:[^\\/:*?"<>|\s，。；：！？、,;:!?()\[\]{}]+[\\/])*[^\\/:*?"<>|\s，。；：！？、,;:!?()\[\]{}]+\.py(?=[\s，。；：！？、,;:!?()\[\]{}]|$)'
        paths = re.findall(pattern, command)
        return paths[0] if paths else None

    # wrap_tool_call的中间件
    # 如果包含root_dir，就消掉即可。
    async def awrap_tool_call(self,request,handler):
        # 1. 先识别出它是终端命令这个工具
        if request.tool_call.get('name') == 'run_command':
            # 2. 得到command参数
            command = request.tool_call['args'].get('command')
            # 3. 用正则把command参数中找到路径相关的字符串
            old_path = self.get_path_from_command(command)
            if old_path:
                # 4. 把路径字符串处理下加上 root_dir
                new_path = self.change_file_path(old_path)
                # 5. 把原本command的字符串中的旧路径替换成新路径
                command = command.replace(old_path, new_path)
                # 6. 更新request里原本的command参数
                request.tool_call['args']['command'] = command

        response = await handler(request) # 调用工具
        return response


if __name__ == '__main__':
    pass