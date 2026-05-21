# Cloudflare Personal Blog

一个使用 Cloudflare 免费服务部署的简约个人博客：Cloudflare Pages 托管前端，Pages Functions 提供 API，D1 保存文章、标签和留言数据。

## 本地开发

先安装依赖：

```bash
pnpm install
```

准备本地环境变量。如果仓库里没有 `.dev.vars`，复制示例文件：

```bash
cp .dev.vars.example .dev.vars
```

`.dev.vars` 用于本地调试，包含：

```env
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change-me
SESSION_SECRET=change-me-to-a-long-random-string
```

这几个默认值只适合本地临时调试。线上一定要在 Cloudflare Pages 里配置真实值，不要让线上继续使用 `change-me`。

初始化本地 D1 数据库并写入示例文章：

```bash
pnpm db:migrate:local
pnpm db:seed:local
```

构建并启动 Cloudflare Pages 本地预览：

```bash
pnpm build
pnpm cf:dev
```

打开 Wrangler 输出的本地地址即可访问。

## Cloudflare 线上部署

这个项目推荐部署到 Cloudflare Pages，项目名使用 `yc-blog`。Pages 负责托管前端，`functions/api/[[path]].ts` 会作为 Pages Functions 自动提供接口。

### 1. 准备仓库

把代码推送到 Cloudflare Pages 支持连接的 Git 仓库，例如 GitHub 或 GitLab。

如果代码只在 Gitee，需要先同步一份到 GitHub/GitLab，或者改用 Wrangler 手动上传部署。

### 2. 创建 D1 数据库

在本地项目目录登录 Cloudflare：

```bash
pnpm wrangler login
```

创建线上 D1 数据库：

```bash
pnpm wrangler d1 create cloudflare_blog
```

命令输出里会有类似这样的配置：

```toml
[[d1_databases]]
binding = "DB"
database_name = "cloudflare_blog"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

把真实的 `database_id` 填入 `wrangler.toml`。`database_id` 不是密码，可以提交到仓库；真正不能公开的是管理员密码、`SESSION_SECRET` 和 Cloudflare API Token。

### 3. 应用线上数据库迁移

D1 创建后，把 `migrations/` 里的表结构应用到线上数据库：

```bash
pnpm db:migrate:remote
```

后续如果要改数据库结构，也是在 `migrations/` 里新增 SQL 文件，先本地执行：

```bash
pnpm db:migrate:local
```

确认没问题后再执行：

```bash
pnpm db:migrate:remote
```

线上已有文章时，迁移 SQL 要谨慎，优先使用 `ALTER TABLE ... ADD COLUMN` 这类不破坏数据的操作，避免直接 `DROP TABLE` 或删除数据。

### 4. 创建 Cloudflare Pages 项目

进入 Cloudflare Dashboard：

```text
Workers & Pages -> Create application -> Pages -> Connect to Git
```

选择你的仓库，然后填写：

```text
Project name: yc-blog
Production branch: main
Framework preset: None 或 React (Vite)
Build command: pnpm build
Build output directory: dist
Root directory: /
```

如果页面有 `Deploy command` 字段，说明你可能进到了 Workers 构建页面。这个项目优先使用 Pages；如果必须填写部署命令，可以使用：

```bash
npx wrangler pages deploy dist --project-name=yc-blog --branch=main
```

但常规 Pages Git 集成只需要配置构建命令和输出目录。

### 5. 配置环境变量和 Secret

进入 Pages 项目：

```text
Settings -> Variables and Secrets
```

添加生产环境变量：

```text
ADMIN_USERNAME = admin
ADMIN_PASSWORD = 你的线上管理员密码
SESSION_SECRET = 一串足够长的随机字符串
```

建议把 `ADMIN_PASSWORD` 和 `SESSION_SECRET` 设置为 Secret。Secret 对代码来说和普通环境变量一样使用，但在 Cloudflare 后台不会明文展示。

可以用下面的命令生成 `SESSION_SECRET`：

```bash
node -e "console.log(crypto.randomUUID() + crypto.randomUUID())"
```

修改 `SESSION_SECRET` 后，已经登录的浏览器会失效，需要重新登录，这是正常现象。

### 6. 绑定 D1 数据库

进入 Pages 项目：

```text
Settings -> Bindings -> Add -> D1 database
```

填写：

```text
Variable name: DB
D1 database: cloudflare_blog
```

保存后重新部署一次项目，让绑定和环境变量生效。

### 7. 首次访问

部署完成后访问 Cloudflare 分配的域名：

```text
https://yc-blog.pages.dev
```

使用 `ADMIN_USERNAME` 和 `ADMIN_PASSWORD` 登录后，就可以新增、编辑、删除文章。

### 8. 后续更新

普通代码或样式修改：

```bash
git add .
git commit -m "Update blog"
git push
```

Cloudflare Pages 会自动重新构建和部署。

如果新增了数据库迁移文件，先执行：

```bash
pnpm db:migrate:remote
```

再推送代码，或者至少确保新代码上线前线上数据库已经具备需要的字段。

## 功能

- 首页直接展示文章，移动端自适应。
- 支持搜索标题、摘要和 Markdown 正文。
- 支持标签列表与标签筛选。
- 私密文章只有登录后可见。
- 登录后可新增、编辑、删除文章，支持多标签和公开/登录可见配置。
- Markdown 使用 GitHub 风格渲染，支持 GFM 表格、任务列表和代码块高亮。
