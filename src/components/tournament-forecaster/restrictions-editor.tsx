"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useId, useState } from "react";

import { apiRequest } from "../../lib/client/api.js";
import { errorMessage } from "../../lib/client/format.js";
import { queryKeys } from "../../lib/client/query-keys.js";
import type { Restrictions } from "../../lib/services/tournament/restrictions.js";
import styles from "./forecaster-page.module.css";

type RestrictionsResponse = Omit<Restrictions, "attested_at"> & {
  readonly attested_at: string | null;
};

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((slug) => right.includes(slug));
}

/**
 * The owner's restricted-person attestation (CONTRACTS.md): the listed names
 * they are employed by, a director of, or invested in. Self-reported; the
 * server refuses those names' quotes and trades.
 */
export function RestrictionsEditor() {
  const queryClient = useQueryClient();
  const id = useId();
  const query = useQuery({
    queryKey: queryKeys.tournamentRestrictions,
    queryFn: () => apiRequest<RestrictionsResponse>("/api/t/me/restrictions"),
  });
  const [draft, setDraft] = useState<readonly string[] | null>(null);
  const save = useMutation({
    mutationFn: (companies: readonly string[]) =>
      apiRequest<RestrictionsResponse>("/api/t/me/restrictions", {
        method: "POST",
        body: JSON.stringify({ companies }),
      }),
    onSuccess: (result) => {
      setDraft(null);
      queryClient.setQueryData(queryKeys.tournamentRestrictions, result);
      void queryClient.invalidateQueries({ queryKey: queryKeys.tournamentViewer });
    },
  });

  if (query.isPending) return null;
  if (query.isError) {
    return (
      <p className={styles.affiliationHelp} role="alert">
        {errorMessage(query.error, "Restricted names could not be loaded.")}
      </p>
    );
  }
  const saved = query.data.restricted;
  const selected = draft ?? saved;

  function toggle(slug: string, checked: boolean) {
    save.reset();
    setDraft(checked ? [...selected, slug] : selected.filter((entry) => entry !== slug));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    save.mutate(selected);
  }

  return (
    <form className={styles.restrictionsForm} onSubmit={submit} aria-labelledby={`${id}-legend`}>
      <fieldset className={styles.restrictionsFieldset}>
        <legend className={styles.affiliationLabel} id={`${id}-legend`}>
          Restricted names
        </legend>
        <p className={styles.affiliationHelp}>
          Tick each listed name you are employed by, a director of, or invested in. Its contracts
          are closed to you. Self-reported; play money.
        </p>
        <div className={styles.restrictionsList}>
          {query.data.listed.map((company) => (
            <label key={company.slug} className={styles.restrictionsOption}>
              <input
                type="checkbox"
                checked={selected.includes(company.slug)}
                onChange={(event) => toggle(company.slug, event.target.checked)}
              />
              {company.name}
            </label>
          ))}
        </div>
      </fieldset>
      <button
        type="submit"
        className={styles.affiliationButton}
        disabled={save.isPending || sameSet(selected, saved)}
      >
        Save
      </button>
      <p className={styles.affiliationHelp} role="status">
        {save.isError
          ? errorMessage(save.error, "The restrictions were not saved.")
          : save.isSuccess
            ? "Saved."
            : saved.length === 0
              ? "None attested."
              : `${saved.length} attested.`}
      </p>
    </form>
  );
}
