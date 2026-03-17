"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";

import { confirmRegistration, type ConfirmRegistrationData, type FetchResult } from "../../lib/api";
import styles from "../../styles/inscription.module.css";

type ConfirmationState =
  | { status: "loading"; message: string }
  | { status: "success"; data: ConfirmRegistrationData }
  | { status: "team-full"; message: string }
  | { status: "error"; message: string };

function resolveConfirmationError(result: FetchResult<ConfirmRegistrationData>) {
  if (result.status === 409) {
    return {
      status: "team-full" as const,
      message:
        result.error ?? "Desole, cette equipe s est completee pendant le paiement.",
    };
  }

  if (result.status === 400) {
    return {
      status: "error" as const,
      message:
        result.error ??
        "Le lien de confirmation est invalide ou a expire. Reprends l inscription.",
    };
  }

  return {
    status: "error" as const,
    message: result.error ?? "Une erreur est survenue pendant la validation de ton inscription.",
  };
}

export default function ConfirmationPage() {
  const searchParams = useSearchParams();
  const state = searchParams.get("state");
  const txId = searchParams.get("txId");
  const [viewState, setViewState] = useState<ConfirmationState>({
    status: "loading",
    message: "Validation de ton inscription...",
  });
  const [isPending, startTransition] = useTransition();
  const statusRef = useRef<HTMLDivElement | null>(null);

  const paramsKey = useMemo(() => `${state ?? ""}:${txId ?? ""}`, [state, txId]);

  useEffect(() => {
    if (!state) {
      setViewState({
        status: "error",
        message: "Le lien de confirmation est incomplet. Reprends l inscription.",
      });
      return;
    }

    startTransition(async () => {
      setViewState({ status: "loading", message: "Validation de ton inscription..." });

      const result = await confirmRegistration({ state, txId: txId ?? undefined });
      if (result.ok && result.data) {
        setViewState({ status: "success", data: result.data });
        return;
      }

      setViewState(resolveConfirmationError(result));
    });
  }, [paramsKey, state, txId]);

  useEffect(() => {
    statusRef.current?.focus();
  }, [viewState]);

  return (
    <main className={styles.pageShell}>
      <section className={styles.confirmationSection}>
        <div
          ref={statusRef}
          tabIndex={-1}
          className={styles.statusPanel}
          aria-live="polite"
          aria-busy={viewState.status === "loading" || isPending}
        >
          {(viewState.status === "loading" || isPending) && (
            <>
              <span className={styles.spinner} aria-hidden="true" />
              <p className={styles.statusEyebrow}>Paiement recu</p>
              <h1 className={styles.statusTitle}>Validation de ton inscription...</h1>
              <p className={styles.statusText}>
                Nous verifions ton retour de paiement et la disponibilite de l equipe.
              </p>
            </>
          )}

          {viewState.status === "success" && (
            <>
              <p className={styles.successMark}>Inscription confirmee</p>
              <h1 className={styles.statusTitle}>Ta place est enregistree</h1>
              <p className={styles.statusText}>
                Equipe retenue : <strong>{viewState.data.teamName ?? "Equipe selectionnee"}</strong>
              </p>
              {viewState.data.message && (
                <p className={styles.inlineNotice} role="alert">
                  {viewState.data.message}
                </p>
              )}
              <div className={styles.actionRow}>
                <Link href="/" className={styles.primaryButton}>
                  Retour a l accueil
                </Link>
                <a
                  href="https://example.com/formulaire-complementaire"
                  className={styles.secondaryButton}
                >
                  Completer mes infos
                </a>
              </div>
            </>
          )}

          {viewState.status === "team-full" && (
            <>
              <p className={styles.warningMark}>Equipe complete</p>
              <h1 className={styles.statusTitle}>Cette equipe s est remplie entre temps</h1>
              <p className={styles.statusText} role="alert">
                {viewState.message}
              </p>
              <div className={styles.actionRow}>
                <Link href="/inscription" className={styles.primaryButton}>
                  Choisir une autre equipe
                </Link>
                <Link href="/" className={styles.secondaryButton}>
                  Retour a l accueil
                </Link>
              </div>
            </>
          )}

          {viewState.status === "error" && (
            <>
              <p className={styles.errorMark}>Confirmation impossible</p>
              <h1 className={styles.statusTitle}>Nous n avons pas pu valider ton inscription</h1>
              <p className={styles.statusText} role="alert">
                {viewState.message}
              </p>
              <div className={styles.actionRow}>
                <Link href="/inscription" className={styles.primaryButton}>
                  Reprendre l inscription
                </Link>
                <Link href="/" className={styles.secondaryButton}>
                  Retour a l accueil
                </Link>
              </div>
            </>
          )}
        </div>
      </section>
    </main>
  );
}