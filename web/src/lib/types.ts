export type Profile = {
  id: string;
  email: string;
  role: "super_admin" | "customer";
  business_name: string | null;
  logo_url: string | null;
  created_at: string;
};

export type FbPage = {
  page_id: string;
  page_name: string | null;
  page_access_token: string;
  owner_id: string;
  created_at?: string;
};

export type KeywordReply = {
  id: string;
  page_id: string;
  keyword: string;
  reply: string;
  private_reply?: string | null;
  created_at?: string;
};

export type AiSettings = {
  page_id: string;
  ai_enabled: boolean;
  system_prompt: string | null;
  gemini_keys: string | null;
  groq_keys: string | null;
  gemini_enabled: boolean;
  groq_enabled: boolean;
  debug_alerts_enabled: boolean;
  updated_at?: string;
};

export type PageAccess = {
  id: string;
  page_id: string;
  invited_email: string;
  granted_by: string;
  user_id: string | null;
  created_at?: string;
};

export type Subscription = {
  id: string;
  owner_id: string;
  page_id: string;
  status: "active" | "expired";
  expires_at: string | null;
  updated_at?: string;
};

export type AdminCustomer = Profile & {
  pages: FbPage[];
  subscriptions: Subscription[];
};
