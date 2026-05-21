# Cloudflare Personal Blog

一个使用 Cloudflare 免费服务部署的简约个人博客：Cloudflare Pages 托管前端，Pages Functions 提供 API，D1 保存文章和标签。

## 本地开发

```bash
pnpm install
cp .dev.vars.example .dev.vars
pnpm db:migrate:local
pnpm db:seed:local
pnpm build
pnpm cf:dev
```

打开 Wrangler 输出的本地地址即可访问。`.dev.vars` 中的 `ADMIN_USERNAME`、`ADMIN_PASSWORD` 和 `SESSION_SECRET` 只用于本地，不要提交。

## Cloudflare 部署

1. 创建 D1 数据库：

   ```bash
   pnpm wrangler d1 create cloudflare_blog
   ```

2. 把命令输出的 `database_id` 填入 `wrangler.toml`。
3. 应用远程迁移：

   ```bash
   pnpm db:migrate:remote
   ```

4. 在 Cloudflare Pages 中连接仓库，构建命令设为 `pnpm build`，输出目录设为 `dist`。
5. 在 Pages 项目的 Settings 中绑定 D1：变量名 `DB`，数据库选择 `cloudflare_blog`。
6. 添加生产环境变量/Secret：

   - `ADMIN_USERNAME`
   - `ADMIN_PASSWORD`
   - `SESSION_SECRET`

7. 部署后访问站点，使用管理员账号登录即可新增和编辑文章。

## 功能

- 首页直接展示文章，移动端自适应。
- 支持搜索标题、摘要和 Markdown 正文。
- 支持标签列表与标签筛选。
- 私密文章只有登录后可见。
- 登录后可新增、编辑、删除文章，支持多标签和公开/登录可见配置。
- Markdown 使用 GitHub 风格渲染，支持 GFM 表格、任务列表和代码块高亮。
