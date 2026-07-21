import { authOptions, getUserFromSession } from "@/lib/auth";
import { getProjectService } from "@/modules/projects/server/container";
import { ProjectsPanel } from "@/modules/projects/components/ProjectsPanel";
import { PanelClientHeader } from "./PanelClientHeader";

/**
 * Server Component: loads session + projects via services (no HTTP hop).
 * Interactive create/list refresh is delegated to a client island.
 */
export default async function PanelPage() {
  const user = await getUserFromSession(authOptions);

  if (!user) {
    return (
      <main style={{ padding: "2rem", fontFamily: "system-ui" }}>
        <p>Not signed in.</p>
      </main>
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
    <main style={{ padding: "2rem", fontFamily: "system-ui" }}>
      <PanelClientHeader
        username={user.username}
        projectCount={initialCount}
      />
      <ProjectsPanel />
    </main>
  );
}
