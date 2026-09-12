-- ============================================================
-- 飞云通旅游平台 · 数据库初始化脚本
-- 用法（MySQL 已启动后，任选其一）：
--   1) 命令行：mysql -uroot -p123456 < init_db.sql
--   2) 或运行后端 init_db.py 脚本
-- ============================================================

-- 建库（若不存在）
CREATE DATABASE IF NOT EXISTS `Travel` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 使用该库
USE `Travel`;

-- 建 user 表（若不存在）
CREATE TABLE IF NOT EXISTS `user` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `username`     VARCHAR(64)  NOT NULL COMMENT '用户名（唯一）',
  `password`     VARCHAR(255) NOT NULL COMMENT '密码（哈希存储）',
  `nickname`     VARCHAR(64)  DEFAULT NULL COMMENT '昵称',
  `created_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户表';

-- 建 chat_message 表（对话历史，完整落库）
CREATE TABLE IF NOT EXISTS `chat_message` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `session_id`   VARCHAR(128) NOT NULL COMMENT '会话 id（对应前端 fy_chat_session）',
  `role`         VARCHAR(16)  NOT NULL COMMENT '角色：user / ai',
  `content`      TEXT         NOT NULL COMMENT '消息内容',
  `created_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  KEY `idx_session` (`session_id`, `id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='对话历史表';
