# -*- coding: utf-8 -*-
"""
行程分享存储（MySQL + pymysql）

表 itinerary_share：
    id          BIGINT 主键
    share_id    VARCHAR(32) 唯一短码（用于 URL /share/{share_id}）
    title       行程标题
    payload     JSON 行程内容（包含目的地/日期/每日安排/图片/预算等）
    creator_id  关联 user.id（创建者）
    created_at  创建时间
    expires_at  过期时间（NULL = 永不过期）
"""

import os
import json
import secrets
from typing import Optional
from datetime import datetime

import pymysql

# 复用 user_db 的连接配置
from conn.user_db import MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DB

TABLE_NAME = "itinerary_share"


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
    """确保 itinerary_share 表存在（幂等）。"""
    conn = pymysql.connect(
        host=MYSQL_HOST,
        port=MYSQL_PORT,
        user=MYSQL_USER,
        password=MYSQL_PASSWORD,
        database=MYSQL_DB,
        charset="utf8mb4",
    )
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                CREATE TABLE IF NOT EXISTS {TABLE_NAME} (
                    `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                    `share_id`   VARCHAR(32)  NOT NULL,
                    `title`      VARCHAR(255) NOT NULL DEFAULT '',
                    `payload`    JSON         NOT NULL,
                    `creator_id` BIGINT UNSIGNED DEFAULT NULL,
                    `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    `expires_at` DATETIME     DEFAULT NULL,
                    PRIMARY KEY (`id`),
                    UNIQUE KEY `uk_share_id` (`share_id`),
                    KEY `idx_creator` (`creator_id`)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
                """
            )
        conn.commit()
    finally:
        conn.close()


def _gen_share_id() -> str:
    """生成 8 位短码（base36），足够辨识且 URL 友好。"""
    return secrets.token_urlsafe(6).replace("_", "").replace("-", "")[:8]


def create_share(
    title: str,
    payload: dict,
    creator_id: Optional[int] = None,
    expires_at: Optional[datetime] = None,
) -> str:
    """
    创建一条分享记录，返回 share_id。
    payload 必须是可 JSON 序列化的 dict。
    """
    ensure_table()
    share_id = _gen_share_id()
    # 极端情况下短码冲突，重试 3 次
    for _ in range(3):
        try:
            conn = _connect()
            with conn.cursor() as cur:
                cur.execute(
                    f"INSERT INTO {TABLE_NAME} (share_id, title, payload, creator_id, expires_at) "
                    "VALUES (%s, %s, %s, %s, %s)",
                    (share_id, title, json.dumps(payload, ensure_ascii=False), creator_id, expires_at),
                )
            conn.commit()
            conn.close()
            return share_id
        except pymysql.err.IntegrityError:
            conn.close()
            share_id = _gen_share_id()
            continue
    raise RuntimeError("生成 share_id 失败，请重试")


def get_share(share_id: str) -> Optional[dict]:
    """
    读取分享内容。未过期才返回，否则返回 None。
    """
    ensure_table()
    conn = _connect()
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"SELECT share_id, title, payload, created_at, expires_at, creator_id "
                f"FROM {TABLE_NAME} WHERE share_id = %s",
                (share_id,),
            )
            row = cur.fetchone()
    finally:
        conn.close()

    if not row:
        return None

    # 过期校验
    if row.get("expires_at") and row["expires_at"] < datetime.now():
        return None

    # payload 是 JSON 字段，pymysql 默认按字符串返回，需手动反序列化
    if isinstance(row.get("payload"), (str, bytes, bytearray)):
        try:
            row["payload"] = json.loads(row["payload"])
        except (json.JSONDecodeError, TypeError):
            row["payload"] = {}
    # 时间字段转 ISO 字符串（JSON 友好）
    for k in ("created_at", "expires_at"):
        if isinstance(row.get(k), datetime):
            row[k] = row[k].isoformat()
    return row


def list_shares_by_creator(creator_id: int, limit: int = 20) -> list:
    """列出某用户最近创建的分享（用于"我的行程"列表）。包含完整 payload。"""
    ensure_table()
    conn = _connect()
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"SELECT share_id, title, payload, created_at FROM {TABLE_NAME} "
                "WHERE creator_id = %s ORDER BY created_at DESC LIMIT %s",
                (creator_id, limit),
            )
            rows = cur.fetchall() or []
    finally:
        conn.close()
    for r in rows:
        if isinstance(r.get("created_at"), datetime):
            r["created_at"] = r["created_at"].isoformat()
        # payload 在 MySQL 存的是 JSON 字符串，需要反序列化
        if isinstance(r.get("payload"), (str, bytes, bytearray)):
            try:
                r["payload"] = json.loads(r["payload"])
            except Exception:
                r["payload"] = {}
    return rows


def delete_share(share_id: str, creator_id: Optional[int] = None) -> bool:
    """
    删除一条分享（仅删除数据库行；返回是否真有行被删除）。
    - 如果传 creator_id，仅当 share_id 归属该 creator 时才删（防误删）
    - 如果 creator_id 为 None，则不限创建者（仅在分享已无 owner 链接时使用，目前不调用）
    """
    ensure_table()
    conn = _connect()
    try:
        with conn.cursor() as cur:
            if creator_id is not None:
                cur.execute(
                    f"DELETE FROM {TABLE_NAME} WHERE share_id = %s AND creator_id = %s",
                    (share_id, creator_id),
                )
            else:
                cur.execute(
                    f"DELETE FROM {TABLE_NAME} WHERE share_id = %s",
                    (share_id,),
                )
            affected = cur.rowcount
        conn.commit()
    finally:
        conn.close()
    return affected > 0
