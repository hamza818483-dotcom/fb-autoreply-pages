-- Run this in the Supabase SQL Editor for the FB Auto-Reply app database.
-- Images themselves are stored in Cloudflare R2; only their public URLs are saved here.
ALTER TABLE public.keyword_replies
  ADD COLUMN IF NOT EXISTS reply_image_url text,
  ADD COLUMN IF NOT EXISTS private_reply_image_url text;
