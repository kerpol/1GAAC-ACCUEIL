"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { FormField } from "./FormField";
import { prepareRegistration, type PrepareRegistrationPayload, type Team } from "../lib/api";
import { normalizePersonName, validateRegistrationForm } from "../lib/validation";
import styles from "../styles/inscription.module.css";

type TeamListProps = {
  teams: TeamOption[];
  selectedSchool: string;
  selectedTeamId: string;
  onChange: (teamId: string) => void;
};

type RegistrationFormProps = {
  initialTeams: Team[];
  initialError: string | null;
};

type FormValues = {
  firstName: string;
  lastName: string;
  classroom: string;
  school: string;
  email: string;
  participantType: "" | "prof" | "visiteur" | "joueur";
  teamId: string;
};

type FormErrors = Partial<Record<keyof FormValues | "form", string>>;

const DEFAULT_VALUES: FormValues = {
  firstName: "",
  lastName: "",
  classroom: "",
  school: "",
  email: "",
  participantType: "",
  teamId: "",
};

const PARTICIPANT_OPTIONS = [
  { value: "prof", label: "Prof" },
  { value: "visiteur", label: "Visiteur" },
  { value: "joueur", label: "Joueur" },
] as const;

const SCHOOL_OPTIONS = ["Sacré Coeur", "Freyssinet", "CFA"] as const;
const TEAM_CONFIG = [
  { displayName: "équipe sacré-coeur 1", allowedSchools: ["Sacré Coeur"] },
  { displayName: "équipe sacré-coeur 2", allowedSchools: ["Sacré Coeur"] },
  { displayName: "équipe CFA", allowedSchools: ["CFA"] },
  { displayName: "équipe Freyssinet", allowedSchools: ["Freyssinet"] },
] as const;

type TeamOption = Team & {
  allowedSchools: readonly string[];
};

// Débloque le formulaire à partir de vendredi 20 mars 2026 à 20h
const FORM_OPEN_DATE = new Date(2026, 2, 20, 20, 0, 0); // 20 mars 2026 20:00:00
const FORM_IS_OPEN = new Date() >= FORM_OPEN_DATE;
const FORM_CLOSED_MESSAGE = "Le formulaire sera disponible a partir du vendredi 20 mars.";

function buildFullName(firstName: string, lastName: string) {
  return [normalizePersonName(firstName), normalizePersonName(lastName)]
    .filter(Boolean)
    .join(" ")
    .trim();
}

function getFirstErrorField(errors: FormErrors): keyof FormValues | null {
  const order: Array<keyof FormValues> = [
    "firstName",
    "lastName",
    "classroom",
    "school",
    "email",
    "participantType",
    "teamId",
  ];
  return order.find((key) => Boolean(errors[key])) ?? null;
}

function normalizeTeams(teams: Team[]): TeamOption[] {
  return TEAM_CONFIG.map((config, index) => {
    const team = teams[index];
    if (!team) {
      return null;
    }

    return {
      ...team,
      name: config.displayName,
      allowedSchools: config.allowedSchools,
    };
  }).filter((team): team is TeamOption => team !== null);
}

export function TeamList({ teams, selectedSchool, selectedTeamId, onChange }: TeamListProps) {
  return (
    <fieldset className={styles.teamFieldset}>
      <legend className={styles.sectionLegend}>Choisis ton equipe</legend>
      <p className={styles.sectionHelp} id="team-choice-help">
        {selectedSchool
          ? "Choisis une equipe disponible pour ton lycee."
          : "Choisis d abord ton lycee pour voir les equipes disponibles."}
      </p>
      <div className={styles.teamGrid} role="radiogroup" aria-describedby="team-choice-help">
        {teams.map((team) => {
          const isFull = team.current_count >= team.max_slots;
          const isBlockedBySchool = !selectedSchool || !team.allowedSchools.includes(selectedSchool);
          const isDisabled = isFull || isBlockedBySchool;
          const isSelected = selectedTeamId === team.id;

          return (
            <label
              key={team.id}
              className={`${styles.teamCard} ${isSelected ? styles.teamCardSelected : ""} ${
                isDisabled ? styles.teamCardDisabled : ""
              }`.trim()}
              aria-disabled={isDisabled}
            >
              <div className={styles.teamHeader}>
                <span className={styles.teamName}>{team.name}</span>
                {(isFull || isBlockedBySchool) && (
                  <span className={styles.badgeFull}>{isFull ? "Complet" : "Indisponible"}</span>
                )}
              </div>
              <p className={styles.teamMeta}>
                {team.current_count}/{team.max_slots} joueurs inscrits
              </p>
              <input
                type="radio"
                name="teamId"
                value={team.id}
                checked={isSelected}
                onChange={() => onChange(team.id)}
                disabled={isDisabled}
                className={styles.teamRadio}
                aria-label={`${team.name}, ${team.current_count} sur ${team.max_slots}`}
              />
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function RegistrationForm({ initialTeams, initialError }: RegistrationFormProps) {
  const [teams] = useState<Team[]>(initialTeams);
  const [values, setValues] = useState<FormValues>(DEFAULT_VALUES);
  const [errors, setErrors] = useState<FormErrors>({});
  const [globalMessage, setGlobalMessage] = useState<string | null>(initialError);
  const [isPending, startTransition] = useTransition();

  const alertRef = useRef<HTMLDivElement | null>(null);
  const firstNameRef = useRef<HTMLInputElement | null>(null);
  const lastNameRef = useRef<HTMLInputElement | null>(null);
  const classroomRef = useRef<HTMLInputElement | null>(null);
  const schoolRef = useRef<HTMLSelectElement | null>(null);
  const emailRef = useRef<HTMLInputElement | null>(null);
  const teamAnchorRef = useRef<HTMLDivElement | null>(null);

  const visibleTeams = useMemo(() => normalizeTeams(teams), [teams]);

  const selectedTeam = useMemo(
    () => visibleTeams.find((team) => team.id === values.teamId) ?? null,
    [visibleTeams, values.teamId],
  );

  const formIsValid = useMemo(() => {
    if (values.participantType !== "joueur") {
      return false;
    }

    if (!values.teamId) {
      return false;
    }

    return validateRegistrationForm({
      fullName: buildFullName(values.firstName, values.lastName),
      classroom: values.classroom,
      school: values.school,
      email: values.email,
      teamId: values.teamId,
    }).isValid;
  }, [values]);

  useEffect(() => {
    if (globalMessage) {
      alertRef.current?.focus();
    }
  }, [globalMessage]);

  function focusField(fieldName: keyof FormValues | null) {
    if (fieldName === "firstName") {
      firstNameRef.current?.focus();
      return;
    }

    if (fieldName === "lastName") {
      lastNameRef.current?.focus();
      return;
    }

    if (fieldName === "classroom") {
      classroomRef.current?.focus();
      return;
    }

    if (fieldName === "school") {
      schoolRef.current?.focus();
      return;
    }

    if (fieldName === "email") {
      emailRef.current?.focus();
      return;
    }

    if (fieldName === "participantType") {
      teamAnchorRef.current?.focus();
      return;
    }

    if (fieldName === "teamId") {
      teamAnchorRef.current?.focus();
    }
  }

  function handleValueChange<Key extends keyof FormValues>(key: Key, value: FormValues[Key]) {
    setValues((current) => {
      const next = { ...current, [key]: value };

      if (key === "school") {
        const currentTeam = visibleTeams.find((team) => team.id === current.teamId);
        if (currentTeam && !currentTeam.allowedSchools.includes(String(value))) {
          next.teamId = "";
        }
      }

      if (key === "participantType" && value !== "joueur") {
        next.teamId = "";
      }

      return next;
    });
    setErrors((current) => ({
      ...current,
      [key]: undefined,
      teamId: undefined,
      participantType: undefined,
      form: undefined,
    }));
    setGlobalMessage(null);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setGlobalMessage(null);

    if (!FORM_IS_OPEN) {
      setErrors((current) => ({ ...current, form: FORM_CLOSED_MESSAGE }));
      setGlobalMessage(FORM_CLOSED_MESSAGE);
      return;
    }

    const fullName = buildFullName(values.firstName, values.lastName);
    const validation = validateRegistrationForm({
      fullName,
      classroom: values.classroom,
      school: values.school,
      email: values.email,
      teamId: values.teamId,
    });

    const nextErrors: FormErrors = {
      firstName: !values.firstName.trim() ? "Renseigne ton prenom." : undefined,
      lastName: !values.lastName.trim() ? "Renseigne ton nom." : undefined,
      classroom: validation.errors.classroom,
      school: validation.errors.school,
      email: validation.errors.email,
      participantType: !values.participantType ? "Choisis ton profil." : undefined,
      teamId: values.participantType === "joueur" ? validation.errors.teamId : undefined,
      form: validation.errors.form,
    };

    const hasErrors = Object.values(nextErrors).some(Boolean);
    if (hasErrors) {
      setErrors(nextErrors);
      const firstErrorField = getFirstErrorField(nextErrors);
      focusField(firstErrorField);
      return;
    }

    const payload: PrepareRegistrationPayload = {
      fullName,
      classroom: values.classroom.trim(),
      email: values.email.trim().toLowerCase(),
      teamId: values.teamId,
    };

    startTransition(async () => {
      const result = await prepareRegistration(payload);
      if (result.ok && result.data?.redirectUrl) {
        window.location.href = result.data.redirectUrl;
        return;
      }

      const nextMessage =
        result.status === 429
          ? result.error ?? "Trop de tentatives. Attends quelques secondes avant de recommencer."
          : result.error ?? "Impossible de lancer le paiement pour le moment.";

      setErrors((current) => ({ ...current, form: nextMessage }));
      setGlobalMessage(nextMessage);
    });
  }

  return (
    <section className={styles.formSection} aria-labelledby="form-title">
      <div className={styles.formIntro}>
        <h2 id="form-title" className={styles.sectionTitle}>
          Completer mon inscription
        </h2>
        <p className={styles.sectionText}>
          Tous les champs sont obligatoires. Le paiement est indispensable pour valider ta
          participation.
        </p>
      </div>

      {globalMessage && (
        <div ref={alertRef} tabIndex={-1} className={styles.alertBox} role="alert">
          {globalMessage}
        </div>
      )}

      <form className={styles.registrationForm} onSubmit={handleSubmit} noValidate>
        <div className={styles.formGrid}>
          <FormField
            ref={firstNameRef}
            id="firstName"
            name="firstName"
            label="Prenom"
            placeholder="Ex. Lina"
            autoComplete="given-name"
            required
            value={values.firstName}
            error={errors.firstName}
            onChange={(event) => handleValueChange("firstName", event.target.value)}
          />
          <FormField
            ref={lastNameRef}
            id="lastName"
            name="lastName"
            label="Nom"
            placeholder="Ex. Martin"
            autoComplete="family-name"
            required
            value={values.lastName}
            error={errors.lastName}
            onChange={(event) => handleValueChange("lastName", event.target.value)}
          />
          <FormField
            ref={classroomRef}
            id="classroom"
            name="classroom"
            label="Classe"
            placeholder="Ex. 2nde B"
            required
            value={values.classroom}
            error={errors.classroom}
            onChange={(event) => handleValueChange("classroom", event.target.value)}
          />
          <div className={styles.fieldWrap}>
            <label className={styles.fieldLabel} htmlFor="school">
              <span>Lycee</span>
              <span className={styles.requiredMark}>*</span>
            </label>
            <select
              ref={schoolRef}
              id="school"
              name="school"
              className={`${styles.fieldInput} ${errors.school ? styles.fieldInputError : ""}`.trim()}
              value={values.school}
              aria-invalid={Boolean(errors.school)}
              aria-describedby={errors.school ? "school-error" : undefined}
              onChange={(event) => handleValueChange("school", event.target.value)}
              required
            >
              <option value="">Choisir un lycee</option>
              {SCHOOL_OPTIONS.map((school) => (
                <option key={school} value={school}>
                  {school}
                </option>
              ))}
            </select>
            {errors.school && (
              <p id="school-error" className={styles.fieldError} role="alert">
                {errors.school}
              </p>
            )}
          </div>
          <FormField
            ref={emailRef}
            id="email"
            name="email"
            type="email"
            label="Email"
            placeholder="prenom.nom@exemple.fr"
            autoComplete="email"
            required
            value={values.email}
            error={errors.email}
            onChange={(event) => handleValueChange("email", event.target.value)}
          />

          <div className={styles.fieldWrap}>
            <p className={styles.fieldLabel} id="participantType-label">
              <span>Profil</span>
              <span className={styles.requiredMark}>*</span>
            </p>
            <div
              className={styles.roleChoices}
              role="radiogroup"
              aria-labelledby="participantType-label"
              aria-describedby={errors.participantType ? "participantType-error" : undefined}
            >
              {PARTICIPANT_OPTIONS.map((option) => {
                const isSelected = values.participantType === option.value;

                return (
                  <label
                    key={option.value}
                    className={`${styles.roleChoice} ${isSelected ? styles.roleChoiceSelected : ""}`.trim()}
                  >
                    <input
                      type="radio"
                      name="participantType"
                      value={option.value}
                      checked={isSelected}
                      onChange={(event) =>
                        handleValueChange("participantType", event.target.value as FormValues["participantType"])
                      }
                      className={styles.roleRadio}
                    />
                    <span>{option.label}</span>
                  </label>
                );
              })}
            </div>
            {errors.participantType && (
              <p id="participantType-error" className={styles.fieldError} role="alert">
                {errors.participantType}
              </p>
            )}
          </div>
        </div>

        <div
          ref={teamAnchorRef}
          tabIndex={errors.teamId ? -1 : undefined}
          className={errors.teamId ? styles.teamErrorWrap : undefined}
        >
          {values.participantType === "joueur" ? (
            <TeamList
              teams={visibleTeams}
              selectedSchool={values.school}
              selectedTeamId={values.teamId}
              onChange={(teamId) => handleValueChange("teamId", teamId)}
            />
          ) : (
            <p className={styles.inlineNotice}>Selectionne le profil joueur pour choisir une equipe.</p>
          )}
          {errors.teamId && (
            <p className={styles.fieldError} role="alert">
              {errors.teamId}
            </p>
          )}
        </div>

        <div className={styles.summaryCard} aria-live="polite">
          <p className={styles.summaryLabel}>Selection actuelle</p>
          <p className={styles.summaryValue}>
            {selectedTeam ? `${selectedTeam.name} · ${selectedTeam.current_count}/${selectedTeam.max_slots}` : "Aucune equipe selectionnee"}
          </p>
        </div>

        <button type="submit" className={styles.primaryButton} disabled={!FORM_IS_OPEN || !formIsValid || isPending}>
          {isPending ? (
            <span className={styles.buttonInlineState}>
              <span className={styles.spinnerSmall} aria-hidden="true" />
              Validation en cours...
            </span>
          ) : (
            FORM_IS_OPEN ? "Valider et payer" : "Formulaire disponible vendredi 20 mars"
          )}
        </button>
      </form>
    </section>
  );
}