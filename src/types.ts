export type Visibility = "public" | "private" | "password";
export type ImageHostProvider = "imgbb" | "pixhost";

export interface ImageUploadResponse {
  url: string;
  provider: ImageHostProvider;
}

export interface Tag {
  id: number;
  name: string;
  slug: string;
  count?: number;
}

export interface ArticleSummary {
  slug: string;
  title: string;
  excerpt: string;
  coverImageUrl: string;
  searchSnippet?: string;
  visibility: Visibility;
  createdAt: string;
  updatedAt: string;
  tags: Tag[];
}

export interface Article extends ArticleSummary {
  content: string;
  accessPassword?: string;
}

export interface ArticleListResponse {
  articles: ArticleSummary[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

export interface ArticleSearchResponse {
  articleResult: ArticleListResponse;
  allArticleTotal: number;
  tags: Tag[];
}

export interface ArticleInput {
  title: string;
  excerpt: string;
  coverImageUrl: string;
  content: string;
  visibility: Visibility;
  accessPassword: string;
  tags: string[];
}

export interface GuestbookMessage {
  id: number;
  parentId: number | null;
  nickname: string;
  email?: string;
  content: string;
  replyToNickname?: string;
  status?: "pending" | "approved";
  createdAt: string;
  replies: GuestbookMessage[];
}

export interface GuestbookInput {
  nickname: string;
  email: string;
  content: string;
  parentId?: number | null;
  captchaToken?: string;
  captchaAnswer?: string;
}

export interface GuestbookCaptcha {
  question: string;
  token: string;
  expiresAt: number;
}

export interface ApiErrorPayload {
  error?: {
    code: string;
    message: string;
  };
}
