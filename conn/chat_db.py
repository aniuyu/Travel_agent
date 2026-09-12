# -*- coding: utf-8 -*-
"""
对话历史存储（MySQL + pymysql）

表 chat_message：
    id          BIGINT 主键
    session_id  VARCHAR(128) 会话 id（对应前端 localStorage 里的 fy_chat_session / thread_id）
    role        VARCHAR(16)  角色：user / ai
    content     TEXT         消息内容（AI 的完整最终文本 / 用户输入）
    created_at  DATETIME     时间

设计：
    - 每轮对话落一条（用户一条 + AI 一条），不做增量 token 存储
    - 索引 (session_id, id) 保证按会话 + 时间顺序拉取
"""

import os
from typing import Optional
from datetime import datetime

import pymysql

# 复用 user_db 的连接配置
from conn.user_db import MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DB

TABLE_NAME = "chat_message"


def _connect(database: Optional[str] = MYSQL_DB):
    return pymysql.connect(
        host=MYSQL_HOST,
        port=MYSQL_PORT,
        user=MYSQL_USER,
        password=MYSQL_PASSWORD,
        database=database,
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
    )


def ensure_table() -> None:
    """确保 chat_message 表存在（幂等）。"""
    conn = _connect()
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                CREATE TABLE IF NOT EXISTS {TABLE_NAME} (
                    `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
                    `session_id` VARCHAR(128) NOT NULL COMMENT '会话 id（对应前端 fy_chat_session）',
                    `role`       VARCHAR(16)  NOT NULL COMMENT '角色：user / ai',
                    `content`    TEXT         NOT NULL COMMENT '消息内容',
                    `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
                    PRIMARY KEY (`id`),
                    KEY `idx_session` (`session_id`, `id`)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='对话历史表'
                """
            )
        conn.commit()
    finally:
        conn.close()


def insert_message(session_id: str, role: str, content: str) -> None:
    """落一条消息。role 必须是 'user' 或 'ai'。"""
    role = role.lower()
    if role not in ("user", "ai"):
        raise ValueError("role must be 'user' or 'ai'")
    if not content:
        return  # 空内容不落库
    ensure_table()
    conn = _connect()
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"INSERT INTO {TABLE_NAME} (session_id, role, content) VALUES (%s, %s, %s)",
                (session_id, role, content),
            )
        conn.commit()
    finally:
        conn.close()


def get_history(session_id: str, limit: int = 100) -> list[dict]:
    """按 session_id 拉取历史（正序，最早的在前）。"""
    ensure_table()
    conn = _connect()
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"SELECT id, session_id, role, content, created_at "
                f"FROM {TABLE_NAME} WHERE session_id = %s ORDER BY id ASC LIMIT %s",
                (session_id, limit),
            )
            rows = cur.fetchall()
    finally:
        conn.close()
    # datetime 转字符串，方便 JSON 序列化
    for r in rows:
        if isinstance(r.get("created_at"), datetime):
            r["created_at"] = r["created_at"].strftime("%Y-%m-%d %H:%M:%S")
    return rows


def delete_session(session_id: str) -> int:
    """删除某个会话的全部历史，返回删除条数。"""
    ensure_table()
    conn = _connect()
    try:
        with conn.cursor() as cur:
            cur.execute(f"DELETE FROM {TABLE_NAME} WHERE session_id = %s", (session_id,))
            deleted = cur.rowcount
        conn.commit()
    finally:
        conn.close()
    return deleted
