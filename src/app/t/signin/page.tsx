import { SignInPage } from "../../../components/tournament-signin/signin-page.js";

export const metadata = { title: "Sign in" };

interface SignInRouteProps {
  readonly searchParams: Promise<{ readonly return?: string }>;
}

export default async function SignInRoute({ searchParams }: SignInRouteProps) {
  const { return: returnTo } = await searchParams;
  return <SignInPage returnTo={returnTo ?? null} />;
}
