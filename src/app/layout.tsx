import type { ReactNode } from "react";
import { Lato } from "next/font/google";
import { Providers } from "@/components/Providers";
import "./globals.css";

const lato = Lato({
  subsets: ["latin"],
  weight: ["400", "700", "900"],
  variable: "--font-lato",
  display: "swap",
});

export const metadata = {
  title: "GIVA Retail",
  description: "GIVA retail store performance",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={lato.variable}>
      <body className="min-h-screen">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
