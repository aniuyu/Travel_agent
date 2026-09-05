FROM langchain/langgraph-api:3.11

# -- Adding non-package dependency all_agent_study --
ADD . /deps/outer-all_agent_study/src

# 设置非交互式安装，避免时区等交互提示
ENV DEBIAN_FRONTEND=noninteractive

# ========== 1. 配置 Debian 镜像源（关键修改）==========
# 清除可能存在的缓存问题
RUN rm -rf /var/lib/apt/lists/* && \
    ( [ -f /etc/apt/sources.list ] && \
        sed -i 's/deb.debian.org/mirrors.tuna.tsinghua.edu.cn/g' /etc/apt/sources.list && \
        sed -i 's/security.debian.org/mirrors.tuna.tsinghua.edu.cn/g' /etc/apt/sources.list ) || \
    ( [ -f /etc/apt/sources.list.d/debian.sources ] && \
        sed -i 's|http://deb.debian.org|https://mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list.d/debian.sources && \
        sed -i 's|http://security.debian.org|https://mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list.d/debian.sources ) || \
    ( echo "deb https://mirrors.tuna.tsinghua.edu.cn/debian/ bookworm main contrib non-free non-free-firmware" > /etc/apt/sources.list && \
      echo "deb https://mirrors.tuna.tsinghua.edu.cn/debian/ bookworm-updates main contrib non-free non-free-firmware" >> /etc/apt/sources.list && \
      echo "deb https://mirrors.tuna.tsinghua.edu.cn/debian-security bookworm-security main contrib non-free non-free-firmware" >> /etc/apt/sources.list )

# ========== 2. 更新包索引并安装所有系统依赖 ==========
# 合并为一个 RUN 命令，避免多次 update
RUN apt-get update --fix-missing && \
    apt-get install -y --no-install-recommends --fix-missing \
        curl \
        pandoc \
        texlive-xetex \
        texlive-latex-base \
        texlive-fonts-recommended \
        lmodern \
        fonts-wqy-microhei \
        fonts-wqy-zenhei \
        texlive-lang-chinese \
        fonts-noto-cjk \
        && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# ========== 3. 安装 Python 依赖 ==========
RUN pip install -r /deps/outer-all_agent_study/src/requirements.txt \
    -i https://pypi.tuna.tsinghua.edu.cn/simple/ \
    --trusted-host pypi.tuna.tsinghua.edu.cn




RUN set -ex && \
    for line in '[project]' \
                'name = "all_agent_study"' \
                'version = "0.1"' \
                '[tool.setuptools.package-data]' \
                '"*" = ["**/*"]' \
                '[build-system]' \
                'requires = ["setuptools>=61"]' \
                'build-backend = "setuptools.build_meta"'; do \
        echo "$line" >> /deps/outer-all_agent_study/pyproject.toml; \
    done
# -- End of non-package dependency all_agent_study --



# -- Installing all local dependencies --

RUN for dep in /deps/*; do             echo "Installing $dep";             if [ -d "$dep" ]; then                 echo "Installing $dep";                 (cd "$dep" && PYTHONDONTWRITEBYTECODE=1 uv pip install --system --no-cache-dir -c /api/constraints.txt -e .);             fi;         done

# 设置 LangGraph HTTP 服务的应用入口（指向 src/app.py 中的 app 对象）
ENV LANGGRAPH_HTTP='{"app": "/deps/outer-all_agent_study/src/app.py:app"}'

# 设置 LangServe 可用的图定义（指向 src/main.py 中的 agent 对象）
ENV LANGSERVE_GRAPHS='{"agent": "/deps/outer-all_agent_study/src/main.py:agent"}'


# -- Ensure user deps didn't inadvertently overwrite langgraph-api
RUN mkdir -p /api/langgraph_api /api/langgraph_runtime /api/langgraph_license && touch /api/langgraph_api/__init__.py /api/langgraph_runtime/__init__.py /api/langgraph_license/__init__.py
RUN PYTHONDONTWRITEBYTECODE=1 uv pip install --system --no-cache-dir --no-deps -e /api
# -- End of ensuring user deps didn't inadvertently overwrite langgraph-api --
# -- Removing build deps from the final image ~<:===~~~ --
RUN pip uninstall -y pip setuptools wheel
# ！！* 为了让Agent运行时更强大，不要删除pip和setuptools
# RUN rm -rf /usr/local/lib/python*/site-packages/pip* /usr/local/lib/python*/site-packages/setuptools* /usr/local/lib/python*/site-packages/wheel* && find /usr/local/bin -name "pip*" -delete || true
# RUN rm -rf /usr/lib/python*/site-packages/pip* /usr/lib/python*/site-packages/setuptools* /usr/lib/python*/site-packages/wheel* && find /usr/bin -name "pip*" -delete || true
# ！！3. 项目中的excel-mcp用到了uv, 所以保留uv
# RUN uv pip uninstall --system pip setuptools wheel && rm /usr/bin/uv /usr/bin/uvx



WORKDIR /deps/outer-all_agent_study/src