import { expect, it, vi } from "vitest";

vi.mock("../../src/components/tournament-signin/signin-page.js", () => ({
  SignInPage: () => null,
}));
const { default: SignInRoute } = await import("../../src/app/t/signin/page.js");
it("forwards the OAuth failure notice alongside its return path", async () => {
  const page = await SignInRoute({
    searchParams: Promise.resolve({ return: "/portfolio", sign_in: "failed" }),
  });
  expect(page.props).toMatchObject({ returnTo: "/portfolio", signIn: "failed" });
});
