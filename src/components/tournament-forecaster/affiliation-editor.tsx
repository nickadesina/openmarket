"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import { apiRequest } from "../../lib/client/api.js";
import { errorMessage } from "../../lib/client/format.js";
import { queryKeys } from "../../lib/client/query-keys.js";
import { AFFILIATION_MAX_LENGTH } from "../../lib/config/tournament-affiliations.js";
import styles from "./affiliation-editor.module.css";

interface AffiliationEditorProps {
  readonly current: string | null;
  /**
   * The welcome step's continuation. When set, the form is stacked, its
   * submit is the primary action and stays enabled, and an unchanged value
   * continues without a request.
   */
  readonly onContinue?: () => void;
  /** Shown beside the submit when `onContinue` is set: the welcome step's Skip. */
  readonly secondaryAction?: ReactNode;
}

/** The owner's own affiliation: any lab, school, or firm, typed freely. */
export function AffiliationEditor({
  current,
  onContinue,
  secondaryAction,
}: AffiliationEditorProps) {
  const queryClient = useQueryClient();
  const id = useId();
  const [value, setValue] = useState(current ?? "");
  const stepped = onContinue !== undefined;
  const save = useMutation({
    mutationFn: (affiliation: string | null) =>
      apiRequest<{ affiliation: string | null }>("/api/t/me/affiliation", {
        method: "POST",
        body: JSON.stringify({ affiliation }),
      }),
    onSuccess: async (result) => {
      setValue(result.affiliation ?? "");
      await queryClient.invalidateQueries({ queryKey: queryKeys.tournament });
      onContinue?.();
    },
  });
  const unchanged = value.trim() === (current ?? "");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (stepped && unchanged) {
      onContinue();
      return;
    }
    save.mutate(value.trim() === "" ? null : value.trim());
  }

  const help = save.isError ? (
    <p className={`${styles.help} ${styles.error}`} id={`${id}-help`} role="alert">
      {errorMessage(save.error, "The affiliation was not saved.")}
    </p>
  ) : (
    <p className={styles.help} id={`${id}-help`}>
      {save.isSuccess && !stepped
        ? "Saved. It shows beside your name everywhere."
        : "Self-reported and shown beside your name; leave it empty to show none."}
    </p>
  );

  return (
    <form
      className={`${styles.form} ${stepped ? styles.stacked : ""}`}
      onSubmit={submit}
      aria-labelledby={`${id}-label`}
    >
      <label className={styles.label} id={`${id}-label`} htmlFor={`${id}-input`}>
        {stepped ? "Affiliation (optional)" : "Affiliation"}
      </label>
      <input
        id={`${id}-input`}
        className={styles.input}
        value={value}
        maxLength={AFFILIATION_MAX_LENGTH}
        placeholder="Lab, school, or firm"
        aria-describedby={`${id}-help`}
        onChange={(event) => {
          setValue(event.target.value);
          save.reset();
        }}
      />
      {stepped ? (
        <>
          {help}
          <div className={styles.actions}>
            <button type="submit" className={styles.primary} disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save and continue"}
            </button>
            {secondaryAction}
          </div>
        </>
      ) : (
        <>
          <button type="submit" className={styles.button} disabled={save.isPending || unchanged}>
            Save
          </button>
          {help}
        </>
      )}
    </form>
  );
}
