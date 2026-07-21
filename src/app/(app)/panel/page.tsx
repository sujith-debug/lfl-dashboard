import { authOptions, getUserFromSession } from "@/lib/auth";
import { getProjectService } from "@/modules/projects/server/container";
import { ProjectsPanel } from "@/modules/projects/components/ProjectsPanel";
import { AppShell } from "@/components/layout/AppShell";
import { PanelClientHeader } from "./PanelClientHeader";

/**
 * Server Component: loads session + projects via services (no HTTP hop).
 * Interactive create/list refresh is delegated to a client island.
 */
export default async function PanelPage() {
  const user = await getUserFromSession(authOptions);

  if (!user) {
    return (
      <AppShell>
        <main className="rounded-2xl border bg-white p-8 shadow-sm">
          <p className="text-slate-600">Not signed in.</p>
        </main>
      </AppShell>
    );
  }

  let initialCount = 0;
  try {
    const listed = await getProjectService().list({ pageSize: 1 });
    initialCount = listed.pagination.total;
  } catch {
    initialCount = -1;
  }

  return (
    <AppShell>
      <main>
        <PanelClientHeader
          username={user.username}
          projectCount={initialCount}
        />
        <ProjectsPanel />
      </main>
    </AppShell>
  );
}
