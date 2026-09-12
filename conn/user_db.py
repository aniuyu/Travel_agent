# -*- coding: utf-8 -*-
"""
用户数据库访问层（MySQL + pymysql）

负责「注册 / 登录 / 查询用户」的数据库读写。
密码使用 sha256 加盐哈希存储，不落明文。

配置来源：环境变量（优先）→ 默认值（root / 123456）。
    可在 .env 中覆盖：MYSQL_HOST / MYSQL_PORT / MYSQL_USER / MYSQL_PASSWORD / MYSQL_DB
"""

import os
import hashlib
import secrets
from typing import Optional

import pymysql

# ---------------------------------------------------------------------------
# 配置
# ---------------------------------------------------------------------------
MYSQL_HOST = os.getenv("MYSQL_HOST", "127.0.0.1")
MYSQL_PORT = int(os.getenv("MYSQL_PORT", "3306"))
MYSQL_USER = os.getenv("MYSQL_USER", "root")
MYSQL_PASSWORD = os.getenv("MYSQL_PASSWORD", "123456")
MYSQL_DB = os.getenv("MYSQL_DB", "Travel")


def _connect():
    """建立数据库连接（autocommit 关闭，手动提交）。"""
    return pymysql.connect(
        host=MYSQL_HOST,
        port=MYSQL_PORT,
        user=MYSQL_USER,
        password=MYSQL_PASSWORD,
        database=MYSQL_DB,
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
    )


# ---------------------------------------------------------------------------
# 密码哈希
# ---------------------------------------------------------------------------
def _hash_password(password: str, salt: str) -> str:
    """sha256(salt + password)，返回十六进制字符串。"""
    return hashlib.sha256((salt + password).encode("utf-8")).hexdigest()


def _make_salt() -> str:
    return secrets.token_hex(16)


# ---------------------------------------------------------------------------
# 业务方法
# ---------------------------------------------------------------------------
def create_user(username: str, password: str, nickname: Optional[str] = None) -> dict:
    """
    注册新用户。成功返回 {"id": ..., "username": ..., "nickname": ...}；
    用户名已存在时抛 ValueError。
    """
    username = username.strip()
    if not username or not password:
        raise ValueError("用户名和密码不能为空")

    salt = _make_salt()
    pwd_hash = _hash_password(password, salt)
    # 用 salt$hash 形式存，登录时可还原 salt 校验
    stored = f"{salt}${pwd_hash}"

    conn = _connect()
    try:
        with conn.cursor() as cur:
            # 先查重
            cur.execute("SELECT id FROM `user` WHERE username = %s", (username,))
            if cur.fetchone():
                raise ValueError("该用户名已被注册")

            cur.execute(
                "INSERT INTO `user` (username, password, nickname) VALUES (%s, %s, %s)",
                (username, stored, nickname or username),
            )
            conn.commit()
            uid = cur.lastrowid
    finally:
        conn.close()

    return {"id": uid, "username": username, "nickname": nickname or username}


def verify_user(username: str, password: str) -> Optional[dict]:
    """
    校验登录。成功返回用户信息 dict（不含密码），失败返回 None。
    """
    username = username.strip()
    if not username or not password:
        return None

    conn = _connect()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, username, password, nickname FROM `user` WHERE username = %s",
                (username,),
            )
            row = cur.fetchone()
    finally:
        conn.close()

    if not row:
        return None

    stored = row["password"]
    if "$" not in stored:
        return None
    salt, pwd_hash = stored.split("$", 1)
    if _hash_password(password, salt) != pwd_hash:
        return None

    return {
        "id": row["id"],
        "username": row["username"],
        "nickname": row["nickname"],
    }


def get_user_by_id(uid: int) -> Optional[dict]:
    """按 id 查用户（用于切换账号/会话校验）。"""
    conn = _connect()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, username, nickname FROM `user` WHERE id = %s", (uid,)
            )
            row = cur.fetchone()
    finally:
        conn.close()
    return row


# ---------------------------------------------------------------------------
# 初始化（建库建表）
# ---------------------------------------------------------------------------
def init_db() -> None:
    """自动建库建表（幂等）。连接不带 database，先建库再建表。"""
    conn = pymysql.connect(
        host=MYSQL_HOST,
        port=MYSQL_PORT,
        user=MYSQL_USER,
        password=MYSQL_PASSWORD,
        charset="utf8mb4",
    )
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"CREATE DATABASE IF NOT EXISTS `{MYSQL_DB}` "
                "DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
            )
            cur.execute(f"USE `{MYSQL_DB}`")
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS `user` (
                  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
                  `username`   VARCHAR(64)  NOT NULL COMMENT '用户名（唯一）',
                  `password`   VARCHAR(255) NOT NULL COMMENT '密码（哈希存储）',
                  `nickname`   VARCHAR(64)  DEFAULT NULL COMMENT '昵称',
                  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
                  `updated_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
                  PRIMARY KEY (`id`),
                  UNIQUE KEY `uk_username` (`username`)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户表'
                """
            )
        conn.commit()
    finally:
        conn.close()
