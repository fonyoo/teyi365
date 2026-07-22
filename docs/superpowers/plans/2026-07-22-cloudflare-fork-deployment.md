# Cloudflare Fork Deployment Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Fork 本项目的使用者提供一份可直接执行的 Cloudflare Pages、D1、Bindings 和 Secrets 部署指南，并在 README 提供明显入口。

**Architecture:** 新增一份独立中文部署指南，按 Fork 后的真实操作顺序组织；README 只保留简短入口，避免复制整套步骤。指南以 Cloudflare Dashboard 完成 Pages 部署和资源配置，以项目现有 Wrangler 脚本维护 D1 迁移记录。

**Tech Stack:** Markdown、Cloudflare Pages、Pages Functions、D1、Wrangler、pnpm

---

### Task 1: 编写 Fork 部署指南

**Files:**
- Create: `docs/CLOUDFLARE_DEPLOY.md`
- Reference: `wrangler.toml`
- Reference: `package.json`
- Reference: `.dev.vars.example`
- Reference: `migrations/0001_initial.sql` 至 `migrations/0006_password_articles.sql`

- [x] **Step 1: 写明部署前必须准备的项目专属配置**

在指南开头说明：Fork 使用者需要自己的 Cloudflare 账号、Fork 后的 GitHub 仓库、自己的 D1 数据库，以及可选但建议配置的 ImgBB API Key。明确本仓库 `wrangler.toml` 中现有 `database_id` 属于原部署者，不能直接复用。

- [x] **Step 2: 写明 D1 创建和仓库配置流程**

按顺序给出 Cloudflare Dashboard 创建 `cloudflare_blog`、复制数据库 ID、在 Fork 的 `wrangler.toml` 替换 `database_id` 的步骤，并要求保留：

```toml
[[d1_databases]]
binding = "DB"
database_name = "cloudflare_blog"
database_id = "部署者自己的 D1 database_id"
```

- [x] **Step 3: 写明远程迁移流程和数据安全边界**

提供以下命令：

```bash
pnpm install
pnpm wrangler login
pnpm db:migrate:remote
```

说明 Wrangler 会记录已执行迁移，重复运行只应用尚未执行的文件；迁移本身是否影响数据取决于 SQL，本项目当前迁移用于建表、增加字段和索引，不会写入或清空文章。明确不要在线上执行 `pnpm db:seed:local`。

- [x] **Step 4: 写明 Pages Git 部署设置**

提供准确设置：生产分支 `main`、构建命令 `pnpm build`、输出目录 `dist`、根目录 `/`。说明 `functions/api/[[path]].ts` 会随 Pages 自动部署为 Functions。

- [x] **Step 5: 写明 D1 Binding 和 Secrets**

要求生产环境存在名为 `DB` 的 D1 绑定，并配置：

```text
ADMIN_USERNAME
ADMIN_PASSWORD
SESSION_SECRET
IMGBB_API_KEY
```

其中 `ADMIN_PASSWORD`、`SESSION_SECRET`、`IMGBB_API_KEY` 使用加密 Secret；提供 `SESSION_SECRET` 生成命令：

```bash
node -e "console.log(crypto.randomUUID() + crypto.randomUUID())"
```

- [x] **Step 6: 写明重新部署、验收、更新和排错**

要求配置完成后重新部署，并验证首页、管理员登录、文章创建和图片粘贴上传。列出使用原作者 D1 ID、绑定名不是 `DB`、只配置 Preview、未执行迁移、缺少 ImgBB Key 五类常见错误；说明同步上游后若 `migrations/` 新增文件，需要先运行远程迁移再让新代码上线。

### Task 2: 在 README 添加部署入口

**Files:**
- Modify: `README.md`

- [x] **Step 1: 在项目介绍后添加入口**

添加简短段落并链接到相对路径：

```markdown
> Fork 后准备部署自己的实例？请阅读：[Cloudflare 快速部署指南](docs/CLOUDFLARE_DEPLOY.md)。
```

- [x] **Step 2: 检查现有部署章节不产生矛盾**

保留现有详细说明，不重复改写；确认新指南中的构建命令、D1 名称、绑定名和环境变量与 README 一致。

### Task 3: 验证并提交

**Files:**
- Verify: `docs/CLOUDFLARE_DEPLOY.md`
- Verify: `README.md`

- [x] **Step 1: 验证外部链接**

对指南引用的 Cloudflare Pages Git integration、build configuration、Functions bindings、D1 getting started、D1 migrations 和 ImgBB API 链接执行 HTTP 请求，预期状态码为 `200`。

- [x] **Step 2: 验证 Markdown、中文编码和仓库一致性**

运行：

```powershell
git diff --check
rg -n "\\u[0-9a-fA-F]{4}|\?{4,}" README.md docs/CLOUDFLARE_DEPLOY.md
rg -n "ADMIN_USERNAME|ADMIN_PASSWORD|SESSION_SECRET|IMGBB_API_KEY|binding = \"DB\"|db:migrate:remote" README.md docs/CLOUDFLARE_DEPLOY.md package.json wrangler.toml
```

预期：`git diff --check` 无错误；编码扫描无匹配；配置扫描能够找到所有真实配置项。

- [x] **Step 3: 运行项目验证**

运行：

```bash
pnpm test
pnpm build
pnpm typecheck:functions
```

预期：测试、构建和 Pages Functions 类型检查全部通过。

- [x] **Step 4: 提交并推送**

```bash
git add README.md docs/CLOUDFLARE_DEPLOY.md docs/superpowers/plans/2026-07-22-cloudflare-fork-deployment.md
git commit -m "docs: add Cloudflare fork deployment guide"
git push origin main
```

- [ ] **Step 5: 确认 Cloudflare 自动部署**

运行：

```bash
pnpm wrangler pages deployment list --project-name yc-blog
```

预期：最新 `main` 提交对应的 Production 部署状态为 `Active`，线上域名返回 HTTP 200。
