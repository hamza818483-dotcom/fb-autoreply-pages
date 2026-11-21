import type { Metadata, Viewport } from "next";
export const runtime = "edge";
import "./globals.css";
import { AuthProvider } from "@/components/providers/auth-provider";

export const metadata: Metadata = {
  title: "FB Auto-Reply Dashboard",
  description: "ATLAS Facebook comment auto-reply control panel",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="bn" className="h-full antialiased">
      <head>
        {/* Hardcoded as a fallback in case Next.js's generated viewport
            export (above) isn't being emitted correctly under the
            @cloudflare/next-on-pages edge runtime adapter used here. */}
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Hind+Siliguri:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-full flex flex-col" style={{ fontFamily: "'Inter','Hind Siliguri',-apple-system,'Segoe UI',system-ui,sans-serif" }}>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
