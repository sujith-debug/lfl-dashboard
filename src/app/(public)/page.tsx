import { redirect } from "next/navigation";
import { authOptions, getUserFromSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** The board is the app's home: signed-in users go straight to it. */
export default async function HomePage() {
  const user = await getUserFromSession(authOptions);
  redirect(user ? "/lfl" : "/auth/signin?callbackUrl=/lfl");
}
