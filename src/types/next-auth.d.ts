/**
 * Type definitions for NextAuth.js (Keycloak session shape).
 * Package also ships `@foundry/auth-next/types` for the same augmentations.
 */

import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      username: string;
      email?: string | null;
      firstName?: string;
      lastName?: string;
    };
    groups?: string[];
    resource_access?: Record<string, { roles: string[] }>;
    realm_access?: { roles: string[] };
    idToken?: string;
  }

  interface User {
    id: string;
    username: string;
    email?: string | null;
    firstName?: string;
    lastName?: string;
    groups?: string[];
    resource_access?: Record<string, { roles: string[] }>;
    realm_access?: { roles: string[] };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    username?: string;
    firstName?: string;
    lastName?: string;
    groups?: string[];
    resource_access?: Record<string, { roles: string[] }>;
    realm_access?: { roles: string[] };
    idToken?: string;
  }
}
