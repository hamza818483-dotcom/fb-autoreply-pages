import { createBrowserClient } from "@supabase/ssr";

// Use this project's current Supabase publishable key. The old legacy anon
// JWT is rejected by the project's REST API (UNAUTHORIZED_INVALID_API_KEY).
const SUPABASE_URL = "https://wbdyjpjbczfunyhhmtry.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_aQq0-MD_7-rw8sLgAtbJFw_x49dHVmZ";

export function createClient() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
}

export const WORKER_BASE_URL = process.env.NEXT_PUBLIC_WORKER_BASE_URL || "";
