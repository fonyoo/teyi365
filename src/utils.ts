import type { ArticleInput } from "./types";

export const emptyArticleInput: ArticleInput = {
  title: "",
  excerpt: "",
  coverImageUrl: "",
  content: "",
  visibility: "public",
  tags: []
};

export function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(value));
}

/** Builds the hover hint for article date labels. */
export function formatArticleTimeTitle(createdAt: string, updatedAt: string) {
  const createdText = formatDate(createdAt);
  const updatedText = formatDate(updatedAt);

  if (createdText === updatedText) {
    return `创建时间：${createdText}`;
  }

  return `创建时间：${createdText}\n修改时间：${updatedText}`;
}

export function parseTags(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[,，\n]/)
        .map((tag) => tag.trim())
        .filter(Boolean)
    )
  );
}

export function toTagInput(tags: { name: string }[]) {
  return tags.map((tag) => tag.name).join(", ");
}

export function articleToInput(article: {
  title: string;
  excerpt: string;
  coverImageUrl?: string;
  content: string;
  visibility: "public" | "private";
  tags: { name: string }[];
}): ArticleInput {
  return {
    title: article.title,
    excerpt: article.excerpt,
    coverImageUrl: article.coverImageUrl ?? "",
    content: article.content,
    visibility: article.visibility,
    tags: article.tags.map((tag) => tag.name)
  };
}

export function sampleMarkdown() {
  return `# 新文章标题

这里写正文。支持 **粗体**、链接、任务列表、表格和代码块。

## 待办

- [x] 写下想法
- [ ] 继续完善

\`\`\`ts
const hello = "Cloudflare";
console.log(hello);
\`\`\`
`;
}
