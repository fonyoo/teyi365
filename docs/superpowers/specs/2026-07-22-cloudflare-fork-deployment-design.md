# Cloudflare Fork 部署指南设计

## 目标

为已经 Fork 本项目的使用者提供一份聚焦 Cloudflare 配置的部署指南。读者通过 Cloudflare Pages 连接自己的 Fork 完成部署，文档重点解决 D1 数据库、Pages Functions 绑定、生产环境 Secret 和首次数据库迁移等项目专属步骤。

## 范围

正式指南将覆盖：

1. 在 Cloudflare 中创建个人 D1 数据库。
2. 将 Fork 中 `wrangler.toml` 的 `database_id` 替换为部署者自己的数据库 ID。
3. 使用项目已有的 Wrangler 脚本执行全部远程迁移，并说明迁移只应用尚未执行的结构变更，不会自动清空已有文章。
4. 在 Cloudflare Pages 中连接 Fork，配置构建命令、输出目录和生产分支。
5. 确认 Pages Functions 使用名为 `DB` 的 D1 绑定。
6. 配置 `ADMIN_USERNAME`、`ADMIN_PASSWORD`、`SESSION_SECRET` 和 `IMGBB_API_KEY`，并区分普通变量与 Secret。
7. 重新部署后验证首页、管理员登录、文章读写和图片上传。
8. 说明同步上游更新后如何识别并应用新增迁移。
9. 给出常见配置错误及对应排查方法。

正式指南不重复讲解 Git、GitHub Fork、Node.js 或 pnpm 的基础使用，也不引入自动申请高权限 Cloudflare API Token 的部署脚本。

## 推荐流程

采用“Cloudflare Dashboard 部署 + Wrangler 初始化 D1”的组合流程：

1. Fork 仓库。
2. 创建 D1 数据库并取得数据库 ID。
3. 在 Fork 中更新 `wrangler.toml`。
4. 通过 Wrangler 将 `migrations/` 按顺序应用到远程 D1。
5. 在 Cloudflare Pages 中连接 Fork 并部署。
6. 检查 `DB` 绑定，配置生产环境变量和 Secret。
7. 触发一次重新部署并执行功能检查。

不将“在 D1 控制台逐个粘贴 SQL”作为主流程，因为这种方式不能可靠维护 Wrangler 的迁移记录，可能导致后续升级重复执行迁移。

## 文档组织

- 新增 `docs/CLOUDFLARE_DEPLOY.md` 作为面向 Fork 使用者的独立操作指南。
- 在 `README.md` 开头的项目介绍之后添加明显入口，避免 README 重复承载完整步骤。
- 保留 README 现有本地开发和详细命令说明；正式指南只在需要解释命令语义时链接回相关章节。

## 安全与数据约束

- 明确原仓库中的 D1 `database_id` 不是可复用配置，Fork 使用者必须换成自己账号下的 ID。
- `ADMIN_PASSWORD`、`SESSION_SECRET` 和 `IMGBB_API_KEY` 应配置为加密 Secret，不能提交进 Git。
- `SESSION_SECRET` 必须使用足够长的随机值，修改后现有登录会话会失效。
- `pnpm db:migrate:remote` 只执行未应用的迁移；是否影响数据最终取决于迁移 SQL，本项目当前迁移以建表和增加字段为主。
- 不建议对线上数据库执行本地 seed 脚本。

## 验证标准

1. README 中的相对链接能够打开正式部署指南。
2. 指南中的文件名、脚本名、绑定名和环境变量与仓库实际内容一致。
3. 引用的 Cloudflare、GitHub 和 ImgBB 链接均可访问。
4. 指南明确区分 Production 与 Preview 环境配置。
5. 中文保持 UTF-8，没有乱码、连续问号或 Unicode 转义文本。
6. 文档修改通过 `git diff --check`，项目现有测试与构建继续通过。
