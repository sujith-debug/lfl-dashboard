import Link from "next/link";

export default function AuthErrorPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  const error = searchParams.error || "Unknown error";

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border bg-white p-8 shadow-lg shadow-slate-200/60">
        <span className="inline-flex size-10 items-center justify-center rounded-full bg-red-50 text-xl text-red-600">
          !
        </span>
        <h1 className="mt-5 text-2xl font-bold tracking-tight">
          Authentication error
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">{error}</p>
        <Link
          href="/auth/signin"
          className="mt-6 inline-flex rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700"
        >
          Try again
        </Link>
      </div>
    </main>
  );
}
