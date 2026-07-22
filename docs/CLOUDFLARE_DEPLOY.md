# Fork 后部署到 Cloudflare

这份指南面向已经 Fork 本项目、准备在自己的 Cloudflare 账号中部署博客的使用者。Pages 项目可以直接连接 Fork 后的 GitHub 仓库，但 D1 数据库、数据库绑定和 Secret 都属于各自的 Cloudflare 账号，不能从原项目继承。

完整流程是：

1. 创建自己的 D1 数据库。
2. 把 Fork 中的 D1 `database_id` 换成自己的 ID。
3. 执行一次远程数据库迁移。
4. 在 Cloudflare Pages 中连接 Fork 并部署。
5. 检查 `DB` 绑定并配置生产环境 Secret。
6. 重新部署并完成首次检查。

本项目只使用 Cloudflare Pages、Pages Functions 和 D1，不需要 R2，也不要求 Cloudflare 账号绑定支付方式。文章中的图片保存在外部图床，D1 只保存图片 URL。

## 需要单独准备的配置

| 配置 | 用途 | 是否必须 |
| --- | --- | --- |
| D1 数据库 | 保存文章、标签、留言及密码访问记录 | 必须 |
| `ADMIN_USERNAME` | 管理员登录用户名 | 必须 |
| `ADMIN_PASSWORD` | 管理员登录密码 | 必须 |
| `SESSION_SECRET` | 签名管理员登录会话 | 必须 |
| `IMGBB_API_KEY` | 优先使用 ImgBB 上传编辑器图片 | 建议配置 |

没有配置 `IMGBB_API_KEY` 时，图片上传仍可尝试匿名的 Pixhost 备用图床，但会先发生一次 ImgBB 失败，因此建议申请并配置 ImgBB Key。

## 1. 创建自己的 D1 数据库

参考 Cloudflare 的 [D1 入门文档](https://developers.cloudflare.com/d1/get-started/)，在 Cloudflare Dashboard 中进入 D1 数据库页面并创建数据库：

```text
Database name: cloudflare_blog
```

创建完成后，在数据库的 Overview 页面复制 `Database ID`。

## 2. 替换 Fork 中的数据库 ID

打开自己 Fork 仓库里的 `wrangler.toml`。仓库当前填写的 `database_id` 属于原项目部署者，不能在其他 Cloudflare 账号中复用。它不是密码，但必须替换成上一步创建的 D1 数据库 ID。

修改后应类似：

```toml
name = "yc-blog"
compatibility_date = "2026-05-19"
pages_build_output_dir = "dist"

[[d1_databases]]
binding = "DB"
database_name = "cloudflare_blog"
database_id = "这里填写你自己的 D1 Database ID"
```

必须保留 `binding = "DB"`。Pages Functions 通过 `env.DB` 访问数据库，改成其他名字会导致文章、登录和留言接口无法使用。

可以直接在 GitHub 网页中编辑这个文件并提交到自己的 Fork，也可以在本地修改后推送。

如果要使用 `yc-blog` 以外的 Pages 项目名，还需要同时修改 `wrangler.toml` 顶部的 `name`，使它与 Cloudflare Pages 项目名一致。

## 3. 初始化远程数据库

Pages 首次部署不会自动建立数据表。需要在包含自己 `database_id` 的 Fork 项目目录中执行一次：

```bash
pnpm install
pnpm wrangler login
pnpm db:migrate:remote
```

`pnpm wrangler login` 会打开浏览器，请登录准备部署该项目的 Cloudflare 账号并授权。执行迁移时如果 Wrangler 要求确认远程操作，确认数据库名称和账号无误后继续。

本项目的迁移文件位于 `migrations/`，Wrangler 会按文件名顺序执行，并在 D1 中记录已经执行过的迁移。以后再次运行同一条命令时，只会应用尚未执行的迁移。

当前迁移用于创建表、增加字段和索引，不会写入、清空或覆盖文章数据。不过迁移是否影响数据最终取决于 SQL 内容，更新项目后仍应先查看新增的迁移文件。

不要对线上数据库执行下面的本地示例数据命令：

```bash
pnpm db:seed:local
```

它只用于本地开发，并不是线上初始化步骤。有关迁移机制可参考 Cloudflare 的 [D1 migrations 文档](https://developers.cloudflare.com/d1/reference/migrations/)。

## 4. 在 Cloudflare Pages 连接 Fork

参考 Cloudflare 的 [Pages Git integration 文档](https://developers.cloudflare.com/pages/configuration/git-integration/)，在 Dashboard 中进入：

```text
Workers & Pages -> Create application -> Pages -> Connect to Git
```

授权 GitHub 后选择自己 Fork 的仓库，并填写以下构建设置：

```text
Project name: yc-blog
Production branch: main
Framework preset: None 或 React (Vite)
Build command: pnpm build
Build output directory: dist
Root directory: /
```

如果 Fork 的默认分支不是 `main`，请把 Production branch 改成实际分支。Cloudflare 的 [Pages 构建配置文档](https://developers.cloudflare.com/pages/configuration/build-configuration/)包含各项设置的完整说明。

仓库中的 `functions/api/[[path]].ts` 会作为 Pages Functions 一起部署，不需要另外创建 Worker。

## 5. 检查 D1 绑定

`wrangler.toml` 已声明 D1 绑定。第一次部署完成后，在 Pages 项目中检查：

```text
Settings -> Bindings
```

应该存在下面的绑定：

```text
Variable name: DB
D1 database: cloudflare_blog
Environment: Production
```

如果没有出现，手动添加 D1 database binding，变量名必须填写 `DB`，然后选择自己创建的 `cloudflare_blog`。Cloudflare 的 [Pages Functions bindings 文档](https://developers.cloudflare.com/pages/functions/bindings/)介绍了绑定的作用和配置方式。

需要测试 Preview 部署时，再给 Preview 环境单独配置同名绑定。只部署正式博客时，先保证 Production 配置正确即可。

## 6. 配置管理员和图床 Secret

进入 Pages 项目：

```text
Settings -> Variables and Secrets
```

在 Production 环境中添加：

| 名称 | 建议类型 | 示例或说明 |
| --- | --- | --- |
| `ADMIN_USERNAME` | 普通变量 | `admin`，也可以改成自己的用户名 |
| `ADMIN_PASSWORD` | Secret | 使用足够长且未在其他网站使用的密码 |
| `SESSION_SECRET` | Secret | 长随机字符串，不能与管理员密码相同 |
| `IMGBB_API_KEY` | Secret | 登录 [ImgBB API](https://api.imgbb.com/) 后生成的 API Key |

可以在本地使用下面的命令生成 `SESSION_SECRET`：

```bash
node -e "console.log(crypto.randomUUID() + crypto.randomUUID())"
```

不要把这些值写入 `wrangler.toml`、前端环境变量、README 或任何会提交到 GitHub 的文件。修改 `SESSION_SECRET` 后，所有已登录的管理员会话都会失效，需要重新登录。

如果还要使用 Preview 部署，请为 Preview 环境单独配置这些值。Production 和 Preview 的变量不会自动互相复制。

## 7. 重新部署

D1 绑定和 Secret 通常需要一次新部署才会被 Pages Functions 使用。可以在 Pages 项目的 Deployments 页面选择最新部署并点击重新部署，也可以向 Fork 的生产分支推送一个新提交。

部署完成后，依次检查：

1. 首页可以正常打开，没有数据库错误。
2. 使用 `ADMIN_USERNAME` 和 `ADMIN_PASSWORD` 可以登录。
3. 可以创建并再次打开一篇测试文章。
4. 在文章编辑器或列表图片输入框粘贴图片时，可以得到图床 URL。
5. Cloudflare Functions 日志中没有 `DB`、数据表或环境变量缺失错误。

## 8. 后续同步项目更新

普通前端或 Functions 更新推送到生产分支后，Cloudflare Pages 会自动重新构建和部署。

如果上游更新新增了 `migrations/*.sql` 文件，推荐按下面的顺序处理：

1. 在本地取得上游新代码，暂时不要让新的 Functions 先上线。
2. 检查新增迁移 SQL 是否符合预期。
3. 执行 `pnpm db:migrate:remote`。
4. 迁移成功后，再把更新推送或合并到 Fork 的生产分支。

这样可以避免新代码已经依赖新字段，但线上数据库尚未完成迁移。不要修改已经在线上执行过的旧迁移文件；数据库结构有变化时应新增迁移文件。

## 常见问题

### 部署时提示 D1 数据库不存在或无权访问

通常是 Fork 仍在使用原仓库的 `database_id`，或者 Wrangler 登录了另一个 Cloudflare 账号。检查 `wrangler.toml`，确认 ID 属于当前账号下创建的 D1。

### 首页打开，但文章接口返回数据库错误

依次检查：

1. 是否执行过 `pnpm db:migrate:remote`。
2. Pages 项目的 D1 绑定名是否严格为 `DB`。
3. 绑定是否配置在 Production 环境。
4. 绑定选择的是否是自己的 `cloudflare_blog` 数据库。

### 管理员无法登录

确认 `ADMIN_USERNAME`、`ADMIN_PASSWORD` 和 `SESSION_SECRET` 都配置在 Production 环境，并在配置完成后重新部署。变量名区分大小写。

### 图片上传先失败一次或完全失败

检查是否配置了有效的 `IMGBB_API_KEY`，以及它是否配置在 Production 环境。未配置时会回退到 Pixhost，但 ImgBB 会先失败一次并进入本地冷却。

### Preview 正常但正式域名不正常，或反过来

Production 和 Preview 的 D1 绑定及 Secret 是两套环境配置。请在出现问题的环境中分别检查，不能只配置其中一套。

### `pnpm db:migrate:remote` 会删除已有文章吗

Wrangler 只负责执行尚未应用的迁移，不会主动清空数据库。当前仓库内的迁移用于建表、增加字段和索引，不会删除已有文章。将来同步更新时仍应先检查新增 SQL，尤其注意 `DROP TABLE`、`DELETE` 或覆盖数据的语句。
