"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId } from "react";

import { formatForecasterName } from "../../lib/client/format.js";
import {
  PUBLIC_FORECAST_HEADING,
  signInHref,
  useTournamentViewer,
} from "../../lib/client/tournament.js";
import { AffiliationEditor } from "../tournament-forecaster/affiliation-editor.js";
import styles from "./welcome-step.module.css";

/**
 * The one step between a new identity's sign-in and the questions: an
 * optional affiliation. Save and Skip both continue to `returnTo`.
 */
export function WelcomeStep({ returnTo }: { readonly returnTo: string }) {
  const router = useRouter();
  const id = useId();
  const viewerQuery = useTournamentViewer();
  const viewer = viewerQuery.data?.viewer ?? null;
  const signedOut = viewerQuery.isSuccess && viewer === null;

  useEffect(() => {
    if (signedOut) router.replace(signInHref(returnTo));
  }, [signedOut, returnTo, router]);

  if (viewerQuery.isError) {
    return (
      <div className={styles.page}>
        <div className={styles.statePanel} role="alert">
          <strong>Your account could not be loaded.</strong>
          <p>The tournament API did not respond. Try again, or go straight to the questions.</p>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => void viewerQuery.refetch()}
            >
              Retry
            </button>
            <Link className={styles.secondaryButton} href={returnTo}>
              Skip
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (viewer === null) {
    return (
      <div className={styles.page}>
        <div className={styles.skeleton} role="status" aria-label="Loading your account" />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <section className={styles.panel} aria-labelledby={`${id}-title`}>
        <header className={styles.header}>
          <p className={styles.step}>One step</p>
          <h1 id={`${id}-title`}>Welcome, {formatForecasterName(viewer.identity)}</h1>
          <p>
            Add the lab, school, or firm you forecast from, or skip it; you can change it later on
            your profile.
          </p>
        </header>

        <AffiliationEditor
          current={viewer.identity.affiliation}
          onContinue={() => router.push(returnTo)}
          secondaryAction={
            <Link className={styles.secondaryButton} href={returnTo}>
              Skip
            </Link>
          }
        />

        <p className={styles.notice}>
          <strong>{PUBLIC_FORECAST_HEADING}</strong> Every forecast you submit is shown under your
          name.
        </p>
      </section>
    </div>
  );
}
