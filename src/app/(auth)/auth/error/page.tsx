export default function AuthErrorPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  const error = searchParams.error || "Unknown error";

  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui" }}>
      <h1>Authentication error</h1>
      <p>{error}</p>
    </main>
  );
}
