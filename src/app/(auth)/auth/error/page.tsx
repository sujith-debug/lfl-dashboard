import Link from "next/link";
import { GivaBar } from "@/modules/lfl/components/GivaBar";
import "@/modules/lfl/components/lfl.css";

const MESSAGES: Record<string, { title: string; body: string }> = {
  AccessDenied: {
    title: "You don't have access yet",
    body: "Your GIVA account signed in, but it isn't allowed to open the LFL board. Ask your manager or the platform team to grant access.",
  },
  Configuration: {
    title: "Sign-in isn't set up correctly",
    body: "The app couldn't reach the sign-in service. Please try again shortly or tell the platform team.",
  },
};

export default function AuthErrorPage({ searchParams }: { searchParams: { error?: string } }) {
  const message = MESSAGES[searchParams.error ?? ""] ?? {
    title: "Sign-in didn't complete",
    body: "Something went wrong while signing you in. Please try again.",
  };

  return (
    <div className="lfl">
      <GivaBar />
      <main className="auth">
        <div className="auth-card">
          <h1>{message.title}</h1>
          <p>{message.body}</p>
          <Link className="btn primary" href="/auth/signin">
            Try again
          </Link>
        </div>
      </main>
    </div>
  );
}
