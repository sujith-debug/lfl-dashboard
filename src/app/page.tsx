import Link from "next/link";

export default function HomePage() {
  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui" }}>
      <h1>Foundry App</h1>
      <p>
        Template project powered by{" "}
        <code>@foundry/auth-next</code>, <code>@foundry/opa-client</code>, and
        shared deploy workflows.
      </p>
      <p>
        <Link href="/auth/signin">Sign in</Link>
        {" · "}
        <Link href="/panel">Panel</Link>
      </p>
    </main>
  );
}
