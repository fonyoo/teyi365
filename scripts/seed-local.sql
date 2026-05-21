INSERT OR IGNORE INTO articles (slug, title, excerpt, cover_image_url, content_md, visibility)
VALUES
  (
    'hello-cloudflare-blog',
    '第一篇公开文章',
    '用 Cloudflare Pages、Functions 和 D1 搭建的简约博客。',
    'https://img11.360buyimg.com/cxxjwimg/jfs/t1/425710/16/10473/279658/69f03108F272d7164/06d7a003996f35ef.png',
    '# 第一篇公开文章

这是一篇公开文章，进入网站就能直接看到。

## 功能清单

- 搜索文章
- 标签筛选
- GitHub 风格 Markdown

```ts
console.log("Hello Cloudflare");
```',
    'public'
  ),
  (
    'private-notes',
    '登录可见的笔记',
    '这篇文章只有管理员登录后才能看到。',
    '',
    '# 登录可见的笔记

这篇文章用于验证私密内容不会对未登录用户展示。',
    'private'
  );

UPDATE articles
SET cover_image_url = 'https://img11.360buyimg.com/cxxjwimg/jfs/t1/425710/16/10473/279658/69f03108F272d7164/06d7a003996f35ef.png'
WHERE slug = 'hello-cloudflare-blog' AND cover_image_url = '';

INSERT OR IGNORE INTO tags (name, slug)
VALUES
  ('Cloudflare', 'cloudflare'),
  ('Markdown', 'markdown'),
  ('Private', 'private');

INSERT OR IGNORE INTO article_tags (article_id, tag_id)
SELECT a.id, t.id
FROM articles a, tags t
WHERE a.slug = 'hello-cloudflare-blog' AND t.slug IN ('cloudflare', 'markdown');

INSERT OR IGNORE INTO article_tags (article_id, tag_id)
SELECT a.id, t.id
FROM articles a, tags t
WHERE a.slug = 'private-notes' AND t.slug IN ('cloudflare', 'private');
