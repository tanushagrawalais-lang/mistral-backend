import Google from "@auth/core/providers/google";
import { setupGoogle } from "@convex-dev/auth/methods/google/server";
import { setupConvexAuth } from "@convex-dev/auth/server";
import { httpRouter } from "convex/server";
import { components, internal } from "./_generated/api";
import { env } from "./_generated/server";

const google = Google({
  clientId: env.AUTH_GOOGLE_CLIENT_ID,
  clientSecret: env.AUTH_GOOGLE_CLIENT_SECRET,
});
void google;

const authCore = setupConvexAuth({ component: components.auth });

export const { signOut, refreshSession, isAuthenticated } = authCore;

export const { startSignInWithGoogle, completeSignInWithGoogle } = setupGoogle(
  authCore,
  {
    component: components.authGoogle,
    allowedRedirectOrigins: [env.CONVEX_SITE_URL, "http://localhost:3000"],
  },
).attachUserCallbacks({
  createUser: internal.users.createUserGoogle,
});

export const auth = {
  addHttpRoutes(http: ReturnType<typeof httpRouter>) {
    return http;
  },
};
