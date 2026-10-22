import { SignInPage } from "../../../components/tournament-signin/signin-page.js";

export const metadata = { title: "Sign in" };

interface SignInRouteProps {
  readonly searchParams: Promise<{ readonly return?: string; readonly sign_in?: string }>;
}

export default async function SignInRoute({ searchParams }: SignInRouteProps) {
  const { return: returnTo, sign_in: signIn } = await searchParams;
  return <SignInPage returnTo={returnTo ?? null} signIn={signIn} />;
}
