# 数据库说明

## 连接信息

| 项目 | 值 |
|------|-----|
| 数据库类型 | MySQL 8.4 LTS |
| 主机 | localhost |
| 端口 | 3306 |
| 用户名 | root |
| 密码 | agent_safety_2026 |
| 数据库名 | agent_safety_platform |
| 字符集 | utf8mb4 |

## 连接方式

### 命令行

```bash
mysql -u root -pagent_safety_2026 agent_safety_platform
```

### 常用查询

```sql
-- 查看所有表
SHOW TABLES;

-- 查看表结构
DESCRIBE agents;

-- 查看智能体列表
SELECT id, name, model_id, status, created_at FROM agents;

-- 查看评估任务
SELECT j.id, j.name, j.status, a.name AS agent_name, j.created_at
FROM eval_jobs j JOIN agents a ON j.agent_id = a.id;

-- 查看评估结果
SELECT t.category, t.task_name, t.score, t.samples_total, t.samples_passed
FROM eval_tasks t WHERE t.job_id = 1;
```

### GUI 工具连接

使用 Navicat / DBeaver / MySQL Workbench 等工具，填写以上连接信息即可。

## 表结构

共 6 张表：

### agents — 智能体

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int, PK, 自增 | 主键 |
| name | varchar(256) | 智能体名称 |
| description | text | 描述 |
| api_base | varchar(512) | API 地址 |
| api_key | varchar(512) | API 密钥 |
| model_id | varchar(256) | 模型标识 |
| system_prompt | text | 系统提示词 |
| tools_enabled | tinyint(1) | 是否启用工具 |
| enabled_tools | json | 启用的工具列表 |
| rag_enabled | tinyint(1) | 是否启用 RAG |
| rag_config | json | RAG 配置 |
| features | json | 扩展特性 |
| status | varchar(32) | 状态（active/deleted） |
| created_at | datetime | 创建时间 |
| updated_at | datetime | 更新时间 |

### eval_jobs — 评估任务

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int, PK, 自增 | 主键 |
| agent_id | int, FK → agents | 关联智能体 |
| name | varchar(256) | 任务名称 |
| status | varchar(32) | 状态（pending/running/completed/failed） |
| categories | json | 评估类别列表 |
| config | json | 评估配置 |
| total_tasks | int | 总子任务数 |
| completed_tasks | int | 已完成子任务数 |
| started_at | datetime | 开始时间 |
| completed_at | datetime | 完成时间 |
| created_at | datetime | 创建时间 |
| updated_at | datetime | 更新时间 |

### eval_tasks — 评估子任务

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int, PK, 自增 | 主键 |
| job_id | int, FK → eval_jobs | 关联评估任务 |
| agent_id | int, FK → agents | 关联智能体 |
| category | varchar(64) | 类别（tool_calling/rag_safety/task_planning/business_safety） |
| task_name | varchar(256) | 子任务名称 |
| status | varchar(32) | 状态（pending/running/success/failed） |
| score | decimal(5,2) | 得分（0.00-1.00） |
| samples_total | int | 总样本数 |
| samples_passed | int | 通过样本数 |
| error_message | text | 错误信息 |
| result_detail | json | 详细结果 |
| started_at | datetime | 开始时间 |
| completed_at | datetime | 完成时间 |
| created_at | datetime | 创建时间 |
| updated_at | datetime | 更新时间 |

### eval_results — 评估样本结果

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int, PK, 自增 | 主键 |
| task_id | int, FK → eval_tasks | 关联子任务 |
| job_id | int, FK → eval_jobs | 关联评估任务 |
| agent_id | int, FK → agents | 关联智能体 |
| sample_id | varchar(128) | 样本 ID |
| input | text | 输入（发给智能体的内容） |
| expected_output | text | 期望输出 |
| actual_output | text | 实际输出 |
| score | decimal(5,2) | 得分 |
| passed | tinyint(1) | 是否通过 |
| scoring_detail | json | 评分详情 |
| created_at | datetime | 创建时间 |

### eval_reports — 评估报告

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int, PK, 自增 | 主键 |
| agent_id | int, FK → agents | 关联智能体 |
| job_id | int, FK → eval_jobs | 关联评估任务 |
| title | varchar(512) | 报告标题 |
| content | longtext | 报告 HTML 内容 |
| summary | json | 汇总数据（含雷达图数据） |
| status | varchar(32) | 状态（draft/generating/ready） |
| created_at | datetime | 创建时间 |
| updated_at | datetime | 更新时间 |

### eval_datasets — 评估数据集

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int, PK, 自增 | 主键 |
| category | varchar(64) | 评估类别 |
| task_name | varchar(256) | 任务名称 |
| name | varchar(256) | 数据集名称 |
| description | text | 描述 |
| version | varchar(32) | 版本号 |
| sample_count | int | 样本数量 |
| data | longtext | 样本数据（JSON） |
| created_at | datetime | 创建时间 |
| updated_at | datetime | 更新时间 |

## 表关系

```
agents (1) ──→ (N) eval_jobs
agents (1) ──→ (N) eval_tasks
agents (1) ──→ (N) eval_results
agents (1) ──→ (N) eval_reports

eval_jobs (1) ──→ (N) eval_tasks
eval_jobs (1) ──→ (N) eval_results
eval_jobs (1) ──→ (1) eval_reports

eval_tasks (1) ──→ (N) eval_results
```

## 配置文件位置

```
server/.env
```

如需修改连接信息，编辑该文件中的 `DB_*` 相关字段即可。后端启动时会自动同步表结构（开发模式下使用 `ALTER TABLE`，不会丢失数据）。
