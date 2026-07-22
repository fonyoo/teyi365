# 文章访问统计设计

## 目标

为博客增加文章浏览次数和仅管理员可见的访问明细后台：

- 文章列表和文章详情公开显示累计浏览次数。
- 同一 IP、同一 User-Agent、同一文章在 30 分钟内只计一次。
- 管理员登录状态下查看文章不计数。
- 永久保存有效访问的完整 IP、设备信息、原始 User-Agent、文章和访问时间。
- 管理员可通过桌面端顶部导航进入统计页并按条件查询。

## 范围

本次包含 D1 迁移、Pages Functions 统计写入与查询接口、前端类型和 API 封装、文章浏览次数展示、管理员统计页、自动测试和响应式验收。

本次不包含访客地理位置、数据导出、图表、日志清理、机器人识别和多管理员权限模型。

## 统计口径

一次访问只有同时满足以下条件才可计数：

1. 文章存在，并且访客已经通过文章的公开性或访问密码校验。
2. 当前请求不是已登录管理员请求。
3. 相同文章、相同 IP 和相同 User-Agent 的上次有效计数距当前时间至少 30 分钟。

密码错误、无权访问、文章不存在和管理员预览均不产生访问明细，也不增加累计数。IP 和 User-Agent 使用 `SESSION_SECRET` 计算 HMAC 访客哈希，哈希只用于去重索引；管理员明细仍保存完整 IP 和原始 User-Agent。

浏览次数表示按上述规则累计的有效访问次数，不表示全局唯一访客数。

## 数据模型

新增迁移 `migrations/0007_article_view_statistics.sql`。

### `articles.view_count`

在 `articles` 增加：

```sql
view_count INTEGER NOT NULL DEFAULT 0
```

已有文章迁移后从 0 开始计数。公开文章列表和详情直接读取该字段，避免针对永久增长的明细表实时聚合。

### `article_views`

每个有效计数保存一条永久访问明细：

```sql
CREATE TABLE article_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  ip_address TEXT NOT NULL,
  visitor_hash TEXT NOT NULL,
  user_agent TEXT NOT NULL DEFAULT '',
  device_type TEXT NOT NULL DEFAULT 'unknown',
  os_name TEXT NOT NULL DEFAULT 'unknown',
  browser_name TEXT NOT NULL DEFAULT 'unknown',
  viewed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

为以下查询建立索引：

- `article_id, viewed_at DESC`
- `visitor_hash, article_id, viewed_at DESC`
- `ip_address, viewed_at DESC`
- `viewed_at DESC`

### `article_view_visitors`

去重状态与访问明细分离，避免并发请求重复计数：

```sql
CREATE TABLE article_view_visitors (
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  visitor_hash TEXT NOT NULL,
  last_counted_at TEXT NOT NULL,
  PRIMARY KEY (article_id, visitor_hash)
);
```

一次请求先通过带时间条件的 UPSERT 争取计数资格。只有成功更新 `last_counted_at` 的请求才能写入 `article_views` 并增加 `articles.view_count`。访问明细插入与累计数增加使用 D1 batch 保持一致。

删除文章时，外键级联删除该文章的访问明细和去重状态。实现仍需在本地迁移验证外键行为。

## 服务端设计

### 文章读取

`GET /api/articles/:slug` 的处理顺序调整为：

1. 查询文章。
2. 校验公开性、管理员会话和文章密码。
3. 对未登录访客尝试记录有效访问。
4. 返回文章、标签和最新 `viewCount`。

统计记录是尽力而为的附属行为。D1 统计写入异常时输出服务端错误，但文章仍正常返回，不能让统计故障阻断阅读。

`GET /api/articles` 和 `GET /api/article-search` 的文章摘要增加 `viewCount`，且不会返回 IP、User-Agent 或访客哈希。

### 客户端信息

服务端优先从 `CF-Connecting-IP` 获取 IP，本地开发回退到 `X-Forwarded-For`，都不存在时使用 `unknown`。User-Agent 来自标准请求头。

使用 `ua-parser-js` 解析：

- 设备类型：`mobile`、`tablet`、`desktop` 或 `unknown`。
- 操作系统：名称和可用版本组成的展示文本。
- 浏览器：名称和可用版本组成的展示文本。

解析异常或缺失数据统一保存为 `unknown`，原始 User-Agent 不做截断。

### 管理员统计接口

新增 `GET /api/statistics`，调用开始时执行管理员鉴权。支持以下查询参数：

- `article`：文章 slug，精确匹配；空值表示全部文章。
- `ip`：IP 片段匹配。
- `device`：同时匹配设备类型、操作系统、浏览器和原始 User-Agent。
- `from`：`YYYY-MM-DD`，包含当天零点之后的数据。
- `to`：`YYYY-MM-DD`，包含所选日期全天。
- `page`：正整数，默认 1。

每页固定 20 条，按 `viewed_at DESC, id DESC` 排序。响应结构为：

```ts
interface ArticleViewStatisticsResponse {
  records: ArticleViewRecord[];
  articles: Array<{ slug: string; title: string }>;
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}
```

每条 `ArticleViewRecord` 包含访问时间、文章 slug 和标题、完整 IP、设备类型、操作系统、浏览器及原始 User-Agent，不包含访客哈希。

日期格式错误、开始日期晚于结束日期和超长查询参数返回 `400 BAD_REQUEST`；未登录请求返回 `403 FORBIDDEN`。

## 前端设计

### 导航与路由

扩展单页应用视图类型，增加 `statistics` 视图和 `/statistics` 路径。

管理员登录后，在顶部导航的“留言板”左侧显示带统计图标的“统计”按钮。该按钮在宽度小于等于 `820px` 时通过 CSS 隐藏。直接访问 `/statistics` 时仍执行鉴权；未登录用户看不到数据，并显示需要登录的状态。

### 文章浏览次数

`ArticleSummary` 和 `Article` 增加 `viewCount: number`。

- 文章列表：在更新时间旁显示眼睛图标和浏览次数。
- 文章详情：在标题元信息区域的更新时间旁显示眼睛图标和浏览次数。

图标使用现有 `lucide-react`，数字区域保持固定的紧凑布局，避免请求返回后造成明显布局移动。

### 统计查询页

统计页沿用现有页面宽度、颜色和控件风格，不使用嵌套卡片。页面包括：

1. 标题和匹配记录总数。
2. 查询表单。
3. 访问明细表格。
4. 分页控件。

查询表单字段为：

- 文章下拉框，选项由接口返回的所有文章组成。
- IP 输入框，支持片段匹配。
- 设备关键词输入框，匹配设备、系统、浏览器和 User-Agent。
- 开始日期和结束日期输入框。
- “查询”和“重置”按钮。

提交查询时回到第 1 页；重置清空全部条件并重新加载。表格列为访问时间、文章、IP、设备类型、操作系统、浏览器和 User-Agent。User-Agent 默认单行截断，通过展开图标查看完整内容；图标按钮带可访问名称和悬停提示。

表格底部显示当前页码、上一页和下一页。没有上一页或下一页时禁用对应按钮。页面提供加载骨架、空结果和接口错误状态，不让上一次查询结果与新查询加载状态混淆。

## 错误与一致性

- 统计权限完全由服务端管理员会话决定，隐藏按钮不是安全边界。
- 公开文章响应只暴露 `viewCount`，不会暴露任何访问明细字段。
- 去重资格、明细和累计数的数据库操作应使用条件写入和 batch，降低并发重复计数风险。
- 设备解析失败不会丢弃访问，使用 `unknown` 保存解析字段。
- 统计写入失败不会阻断文章读取；统计查询失败按现有全局错误提示呈现。
- 所有查询参数使用 D1 绑定参数，不拼接用户输入。

## 测试与验收

实施遵循测试驱动：先添加失败测试并确认失败原因，再编写最小实现。

自动测试覆盖：

- 30 分钟去重边界和访客哈希稳定性。
- 管理员访问不计数。
- 文章不存在、权限失败和密码错误不计数。
- 有效访问返回更新后的 `viewCount`。
- User-Agent 设备、系统和浏览器解析及未知值回退。
- 统计日期过滤的包含边界与非法日期校验。
- 统计接口鉴权和响应不包含访客哈希。
- 文章列表和详情类型均包含浏览次数。

完成前运行：

```bash
pnpm test
pnpm build
pnpm typecheck:functions
pnpm db:migrate:local
```

浏览器验收至少覆盖：

- 桌面端管理员看到统计入口、筛选表单、表格、展开 User-Agent 和分页状态。
- 桌面端文章列表和详情显示浏览次数。
- 宽度小于等于 `820px` 时统计导航按钮不可见。
- 普通访客无法读取统计接口和访问明细。

## 成功标准

1. 同一文章、IP 和 User-Agent 在 30 分钟内最多增加一次浏览次数。
2. 管理员访问不影响浏览次数。
3. 列表与详情显示一致的累计浏览数。
4. 管理员能按文章、IP、设备关键词和日期范围查询永久明细。
5. 非管理员无法通过 UI 或 API 获得访问明细。
6. 统计故障不会导致文章无法阅读。
7. 自动测试、类型检查、构建、D1 本地迁移和桌面/手机响应式验收全部通过。
