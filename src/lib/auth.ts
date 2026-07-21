/**
 * App-level auth wiring. Swap package versions centrally via foundry-npm;
 * teams only configure env and optional pages here.
 */

import { createAuthHandler } from "@foundry/auth-next";

export const { authOptions, authHandler } = createAuthHandler();
