import { createBrowserClient } from "@supabase/ssr";

// This app uses a single Supabase project. Keep public project credentials as
// fallbacks so the browser client still initializes if Pages build variables
// are missing; configured environment variables continue to take precedence.
const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://wbdyjpjbczfunyhhmtry.supabase.co";
const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndiZHlqcGpiY3pmdW55aGhtcnkiLCJyb2xlIjoiYW5vbiIsImlhdCI6MTc4MDY5Mjk4MCwiZXhwIjoyMDk2MjY4OTgwfQ.0WR1sgVsl_1XWZfSd0Pwoe6Uxp-2GMTksfseMn5aWjg";

export function createClient() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

export const WORKER_BASE_URL = process.env.NEXT_PUBLIC_WORKER_BASE_URL || "";
