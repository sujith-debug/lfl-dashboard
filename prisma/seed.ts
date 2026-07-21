import { PrismaClient, ProjectStatus } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Idempotent seed — safe to re-run.
 */
async function main() {
  const demoSlug = "demo-project";

  await prisma.project.upsert({
    where: { slug: demoSlug },
    create: {
      name: "Demo Project",
      slug: demoSlug,
      description: "Seeded demo project for local development",
      status: ProjectStatus.ACTIVE,
      ownerId: "seed-owner",
    },
    update: {
      name: "Demo Project",
      description: "Seeded demo project for local development",
      status: ProjectStatus.ACTIVE,
    },
  });

  console.log(`Seeded project slug=${demoSlug}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
