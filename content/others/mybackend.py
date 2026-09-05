# 自定义一个方法继承backendprotocol
import asyncio

from deepagents.backends import BackendProtocol,FilesystemBackend
from content.utils import runtime_util as ru
import os
from base import config as cfg
import shutil


class LazyFilesystemBackend(BackendProtocol):

    def __init__(self):

        self.thread_id = ru.get_thread_id() # 获取当前线程的id
        self.root_dir = os.path.join(cfg.ROOT_PATH_AGENT,self.thread_id) # 拼接工作目录路径
        self.backend = None

    def _ensure_backend(self):
        # Agent在调用文件操作时，先filesystemMiddleware -> filesystembackend里面的具体文件操作方法
        # 关于异步的处理已经在中间件里做了处理，这里不需要处理
        # 通过thread_id得到filesystembackend的实例的过程，并且顺便执行os.mkdirs这种阻塞操作
        if self.backend is None:
            os.makedirs(self.root_dir, exist_ok=True) # 在物理上创建目录
            # 复制初始的skill到这个目录下（增量同步：把 content/skills 里每个技能目录，
            # 若目标不存在则复制过去，避免"目录已存在就跳过"导致新增技能无法生效）
            skill_dir = os.path.join(self.root_dir, cfg.SKILL_DIR_PATH)
            os.makedirs(skill_dir, exist_ok=True)
            source_skills = os.path.join('content', cfg.SKILL_DIR_PATH)
            if os.path.isdir(source_skills):
                for name in os.listdir(source_skills):
                    src = os.path.join(source_skills, name)
                    dst = os.path.join(skill_dir, name)
                    if os.path.isdir(src) and not os.path.exists(dst):
                        shutil.copytree(src, dst)
            self.backend = FilesystemBackend(root_dir=self.root_dir,virtual_mode=True)
        return self.backend

    # 重写父类里所有抽象方法(具体的文件操作)
    # 重写的过程中，利用原本的filesystembackend的方法，在调用之前它之间添加一些逻辑
    def ls_info(self,path):
        return self._ensure_backend().ls_info(path)

    # deepagents 0.6.x 起，skills 中间件改用 ls()（新 API）替代 ls_info()（已废弃）。
    # 这里补上 ls() 的实现，转发到内部的 FilesystemBackend，否则加载技能时会报
    # "This behavior is only available via the new `ls` API." 导致子代理（如 travel-agent）加载技能失败。
    def ls(self, path: str):
        return self._ensure_backend().ls(path)

    def read(self,file_path: str,
        offset: int = 0,
        limit: int = 2000):
        return self._ensure_backend().read(file_path,offset,limit)

    def grep_raw(
        self,
        pattern: str,
        path: str | None = None,
        glob: str | None = None,
    ):
        return self._ensure_backend().grep_raw(pattern,path,glob)

    def glob_info(self, pattern: str, path: str = "/"):
        return self._ensure_backend().glob_info(pattern,path)

    def write(
        self,
        file_path: str,
        content: str,
    ):
        return self._ensure_backend().write(file_path,content)

    def edit(
        self,
        file_path: str,
        old_string: str,
        new_string: str,
        replace_all: bool = False,  # noqa: FBT001, FBT002
    ):
        return self._ensure_backend().edit(file_path,old_string,new_string,replace_all)

    def upload_files(self, files: list[tuple[str, bytes]]):
        return self._ensure_backend().upload_files(files)

    def download_files(self, paths: list[str]):
        return self._ensure_backend().download_files(paths)


# 通过运行中的数据动态得到后端实例的方法
def backend_factory(runtime) -> BackendProtocol:

    return LazyFilesystemBackend()

