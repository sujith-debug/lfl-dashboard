import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getOpaClient } from "@foundry/opa-client";
import { authOptions, getUserFromSession } from "@/lib/auth";
import { APP_OPA_ACTIONS } from "@/lib/authorization";
import { LflAdmin } from "@/modules/lfl/components/admin/LflAdmin";
import { getLflAdminService } from "@/modules/lfl/server/container";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Data & uploads · Store LFL Board" };

/** Feed status, uploads and carpet areas. Needs the lfl_admin permission. */
export default async function LflAdminPage() {
  const user = await getUserFromSession(authOptions);
  if (!user) {
    redirect("/auth/signin?callbackUrl=/lfl/admin");
  }
  if (!(await getOpaClient().isAllowed(user, APP_OPA_ACTIONS.LFL_ADMIN))) {
    redirect("/auth/error?error=AccessDenied");
  }
  const status = await getLflAdminService().status();
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.username;
  return <LflAdmin userName={name} initial={status} />;
}
