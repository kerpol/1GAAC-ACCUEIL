const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ValidationResult = {
  isValid: boolean;
  errors: {
    fullName?: string;
    classroom?: string;
    email?: string;
    teamId?: string;
    form?: string;
  };
};

export function normalizePersonName(value: string) {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function validateRegistrationForm(input: {
  fullName: string;
  classroom: string;
  email: string;
  teamId: string;
}): ValidationResult {
  const errors: ValidationResult["errors"] = {};
  const fullName = input.fullName.trim();
  const classroom = input.classroom.trim();
  const email = input.email.trim();
  const teamId = input.teamId.trim();

  if (fullName.length < 4) {
    errors.fullName = "Renseigne ton nom complet.";
  }

  if (classroom.length < 2) {
    errors.classroom = "Renseigne ta classe.";
  }

  if (!EMAIL_RE.test(email)) {
    errors.email = "Saisis une adresse email valide.";
  }

  if (!teamId) {
    errors.teamId = "Choisis une equipe avant de continuer.";
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}