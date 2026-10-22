"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useId, useState } from "react";

import { apiRequest } from "../../lib/client/api.js";
import { errorMessage } from "../../lib/client/format.js";
import { AFFILIATION_MAX_LENGTH } from "../../lib/config/tournament-affiliations.js";
import styles from "./forecaster-page.module.css";

/** The owner's own affiliation: any lab, school, or firm, typed freely. */
export function AffiliationEditor({ current }: { readonly current: string | null }) {
  const queryClient = useQueryClient();
  const id = useId();
  const [value, setValue] = useState(current ?? "");
  const save = useMutation({
    mutationFn: (affiliation: string | null) =>
      apiRequest<{ affiliation: string | null }>("/api/t/me/affiliation", {
        method: "POST",
        body: JSON.stringify({ affiliation }),
      }),
    onSuccess: (result) => {
      setValue(result.affiliation ?? "");
      void queryClient.invalidateQueries({ queryKey: ["openmarket", "tournament"] });
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    save.mutate(value.trim() === "" ? null : value.trim());
  }

  return (
    <form className={styles.affiliationForm} onSubmit={submit} aria-labelledby={`${id}-label`}>
      <label className={styles.affiliationLabel} id={`${id}-label`} htmlFor={`${id}-input`}>
        Affiliation
      </label>
      <input
        id={`${id}-input`}
        className={styles.affiliationInput}
        value={value}
        maxLength={AFFILIATION_MAX_LENGTH}
        placeholder="Lab, school, or firm"
        onChange={(event) => {
          setValue(event.target.value);
          save.reset();
        }}
      />
      <button
        type="submit"
        className={styles.affiliationButton}
        disabled={save.isPending || value.trim() === (current ?? "")}
      >
        Save
      </button>
      <p className={styles.affiliationHelp}>
        {save.isError
          ? errorMessage(save.error, "The affiliation was not saved.")
          : save.isSuccess
            ? "Saved. It shows beside your name everywhere."
            : "Self-reported and shown beside your name; leave it empty to show none."}
      </p>
    </form>
  );
}
