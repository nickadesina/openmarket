"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";

import { queryKeys } from "../../lib/client/query-keys.js";
import { signInHref, useTournamentViewer } from "../../lib/client/tournament.js";
import { AdminComments } from "./admin-comments.js";
import styles from "./admin-page.module.css";

/** Admin is the tournament allowlist; the server re-checks it on every operation. */
export function AdminPage() {
  const queryClient = useQueryClient();
  const viewer = useTournamentViewer();
  const refreshAccess = () =>
    void queryClient.invalidateQueries({ queryKey: queryKeys.tournamentViewer });

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <p className={styles.sectionLabel}>Restricted operations</p>
        <h1>Market administration</h1>
        <p>Moderate market comments. Every mutation is validated by the server.</p>
      </header>

      {viewer.isPending ? (
        <p role="status">Checking admin access…</p>
      ) : viewer.data?.isAdmin === true ? (
        <div className={styles.operations}>
          <AdminComments onAdminRequired={refreshAccess} />
        </div>
      ) : (
        <section className={styles.gatePanel} aria-labelledby="admin-gate-heading">
          <div>
            <h2 id="admin-gate-heading">Admin only.</h2>
            <p>
              Admins are an allowlist of accounts in the deployment's configuration. Sign in with an
              allowlisted account to moderate comments.
            </p>
          </div>
          {viewer.data?.viewer == null ? (
            <Link className={styles.primaryButton} href={signInHref("/admin")}>
              Sign in
            </Link>
          ) : null}
        </section>
      )}
    </div>
  );
}
