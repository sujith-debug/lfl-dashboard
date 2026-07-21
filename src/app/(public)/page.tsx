import Link from "next/link";
import { AppShell } from "@/components/layout/AppShell";

export default function HomePage() {
  return (
    <AppShell>
      <main className="flex min-h-[calc(100vh-4rem)] items-center">
        <section className="w-full overflow-hidden rounded-3xl border bg-white shadow-xl shadow-slate-200/60">
          <div className="grid lg:grid-cols-[1.2fr_0.8fr]">
            <div className="p-8 sm:p-12 lg:p-16">
              <span className="inline-flex rounded-full bg-indigo-50 px-3 py-1 text-sm font-semibold text-indigo-700">
                Production-ready Next.js starter
              </span>
              <h1 className="mt-6 max-w-2xl text-4xl font-bold tracking-tight sm:text-6xl">
                Build your next app on solid foundations.
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-8 text-slate-600">
                A feature-first template with authentication, authorization,
                observability, and app-owned Prisma/PostgreSQL built in.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  href="/auth/signin"
                  className="rounded-lg bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-slate-700"
                >
                  Sign in
                </Link>
                <Link
                  href="/panel"
                  className="rounded-lg border bg-white px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Open panel
                </Link>
              </div>
            </div>
            <div className="flex items-center bg-slate-950 p-8 text-slate-200 sm:p-12">
              <div className="grid w-full gap-3">
                {[
                  "@foundry/auth-next",
                  "@foundry/opa-client",
                  "@foundry/logger",
                  "Prisma + PostgreSQL",
                ].map((feature) => (
                  <div
                    key={feature}
                    className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 font-mono text-sm"
                  >
                    {feature}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </main>
    </AppShell>
  );
}
