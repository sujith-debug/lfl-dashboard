import type { ReactNode } from "react";
import { Providers } from "@/components/Providers";

export const metadata = {
  title: "Foundry App",
  description: "Foundry template application",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
