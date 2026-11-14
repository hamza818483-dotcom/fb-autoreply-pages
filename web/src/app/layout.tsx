import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FB Auto-Reply Dashboard",
  description: "ATLAS Facebook comment auto-reply control panel",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="bn" className="h-full antialiased">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Hind+Siliguri:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-full flex flex-col" style={{ fontFamily: "'Inter','Hind Siliguri',-apple-system,'Segoe UI',system-ui,sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
