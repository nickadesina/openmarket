"use client";

/**
 * The questions list's call to action for a signed-out visitor. In the archive
 * there is no sign-in to call to, so it renders nothing; the shell's banner
 * says forecasting is closed.
 */
export function SignInCallout(_props: { readonly returnTo: string }) {
  return null;
}

/** Where a question's forecast editor would ask for sign-in. */
export function SignInExplanation() {
  return (
    <p>
      <strong>Forecasting is closed.</strong> This is the archived v1; every forecast shown is as it
      stood at its last dealer run.
    </p>
  );
}
