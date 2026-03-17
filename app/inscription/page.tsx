import { RegistrationForm } from "../../components/TeamList";
import { getTeams } from "../../lib/api";
import styles from "../../styles/inscription.module.css";

export const dynamic = "force-dynamic";

export default async function InscriptionPage() {
  const teamsResponse = await getTeams({
    cache: "no-store",
    baseUrl:
      process.env.API_BASE_URL ??
      process.env.NEXT_PUBLIC_API_BASE_URL ??
      "http://127.0.0.1:8001",
  });

  const initialTeams = teamsResponse.ok ? teamsResponse.data : [];
  const initialError = teamsResponse.ok
    ? null
    : teamsResponse.error ?? "Impossible de charger la liste des equipes pour le moment.";

  return (
    <main className={styles.pageShell}>
      <section className={styles.heroSection} aria-labelledby="inscription-title">
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>Tournoi futsal du lycee</p>
          <h1 id="inscription-title" className={styles.pageTitle}>
            Inscription des equipes
          </h1>
          <p className={styles.pageLead}>
            Choisis ton equipe, renseigne tes informations et finalise ton paiement pour
            confirmer ta place.
          </p>
        </div>
        <div className={styles.infoCard}>
          <p className={styles.infoLabel}>Important</p>
          <p className={styles.infoText}>
            L inscription n est valide qu apres le paiement HelloAsso. Les places ne sont pas
            reservees avant la confirmation du retour de paiement.
          </p>
        </div>
      </section>

      <RegistrationForm initialTeams={initialTeams} initialError={initialError} />

      {/*
        Checklist de tests manuels:
        - Champs vides: bouton desactive.
        - Email invalide: message visible et focus sur le premier champ en erreur.
        - Equipe complete: radio desactive + badge Complet.
        - Submit: etat de chargement puis redirection vers HelloAsso.
        - Retour /confirmation: succes, 409 equipe complete, 400 state expire, 500 generique.
      */}
    </main>
  );
}