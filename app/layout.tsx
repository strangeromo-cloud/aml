import type { Metadata } from "next";
import "./globals.css";
import { I18nProvider } from "@/lib/i18n/context";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";

export const metadata: Metadata = {
  title: "Lenovo AML Risk Watch",
  description: "Sanctions, country risk & circumvention analytics for customers and suppliers.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <I18nProvider>
          <Header />
          <main className="mx-auto max-w-7xl px-5 py-8">{children}</main>
          <Footer />
        </I18nProvider>
      </body>
    </html>
  );
}
