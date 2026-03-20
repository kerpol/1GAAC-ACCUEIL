(function () {
  const form = document.getElementById("inscription-form");
  if (!form) return;

  // En local, le frontend statique tourne sur :8000 et l'API sur :8001.
  // En production avec reverse-proxy, laisser vide permet d'utiliser le meme host.
  const API_BASE_URL = window.location.port === "8000" ? "http://127.0.0.1:8001" : "";

  function apiUrl(path) {
    return API_BASE_URL ? API_BASE_URL + path : path;
  }

  const schoolInput = document.getElementById("school");
  const formRest = document.getElementById("form-rest");
  const participantTypeInputs = form.querySelectorAll('input[name="participantType"]');
  const teamField = document.getElementById("team-field");
  const teamOptions = document.getElementById("team-options");
  const teamHelp = document.getElementById("team-help");
  const errorBox = document.getElementById("form-error");
  const submitButton = document.getElementById("validate-pay-btn");
  const submitLabel = document.getElementById("validate-pay-label");
  // Débloque le formulaire à partir de vendredi 20 mars 2026 à 20h
  const FORM_OPEN_DATE = new Date(2026, 2, 20, 20, 0, 0); // 20 mars 2026 20:00:00
  const FORM_IS_OPEN = true; // mode test: activation immediate
  const FORM_CLOSED_MESSAGE = "Le formulaire sera disponible a partir du vendredi 20 mars.";
  const TEST_CONFIRMATION_URL = "https://futsalsacrecoeur.vercel.app/confirmation";

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const ALLOWED_SCHOOLS = new Set(["Sacré Coeur", "Freyssinet", "CFA"]);
  const TEAM_CONFIG = [
    { displayName: "équipe sacré-coeur 1", allowedSchools: ["Sacré Coeur"] },
    { displayName: "équipe sacré-coeur 2", allowedSchools: ["Sacré Coeur"] },
    { displayName: "équipe CFA", allowedSchools: ["CFA"] },
    { displayName: "équipe Freyssinet", allowedSchools: ["Freyssinet"] },
  ];
  let selectedTeam = "";
  let visibleTeams = [];

  function setError(message) {
    errorBox.textContent = message;
    errorBox.focus();
  }

  function clearError() {
    errorBox.textContent = "";
  }

  function setLoading(isLoading) {
    submitButton.disabled = isLoading || !FORM_IS_OPEN;
    submitButton.setAttribute("aria-busy", String(isLoading));
    if (!FORM_IS_OPEN) {
      submitLabel.textContent = "Formulaire disponible vendredi 20 mars";
      return;
    }

    submitLabel.textContent = isLoading ? "Traitement..." : "Payer sur HelloAsso";
  }

  function validateFields(payload) {
    if (!payload.school.trim()) return "Veuillez sélectionner votre lycée.";
    if (!ALLOWED_SCHOOLS.has(payload.school)) return "Lycée invalide.";
    if (!payload.participantType) return "Veuillez choisir un profil.";
    if (payload.participantType !== "joueur") return "Seul le profil joueur peut choisir une equipe.";
    if (!payload.teamId) return "Veuillez selectionner une equipe.";
    return null;
  }

  function getSelectedParticipantType() {
    const selected = form.querySelector('input[name="participantType"]:checked');
    return selected ? selected.value : "";
  }

  function updateTeamVisibility() {
    const isPlayer = getSelectedParticipantType() === "joueur";

    if (!teamField) return;

    if (isPlayer) {
      teamField.hidden = false;
      teamHelp.textContent = getTeamHelpMessage();
      renderTeams(visibleTeams);
      return;
    }

    selectedTeam = "";
    teamField.hidden = true;
  }

  function normalizeTeams(teams) {
    return TEAM_CONFIG.map(function (config, index) {
      const team = teams[index];
      if (!team) return null;

      return {
        id: team.id,
        name: config.displayName,
        max_slots: team.max_slots,
        current_count: team.current_count,
        allowedSchools: config.allowedSchools,
      };
    }).filter(Boolean);
  }

  function getSelectedSchool() {
    return schoolInput ? schoolInput.value : "";
  }

  function getTeamHelpMessage() {
    return getSelectedSchool()
      ? "Choisis une équipe disponible pour ton lycée."
      : "Choisis d'abord ton lycée pour voir les équipes disponibles.";
  }

  async function fetchTeams() {
    teamHelp.textContent = "Chargement des equipes...";
    try {
      const response = await fetch(apiUrl("/api/teams"), {
        headers: { Accept: "application/json" },
      });
      const json = await response.json();

      if (!response.ok || !json || json.ok !== true || !Array.isArray(json.data)) {
        throw new Error("team-load");
      }

      visibleTeams = normalizeTeams(json.data);
      updateTeamVisibility();
    } catch (_error) {
      teamHelp.textContent = "Impossible de charger les equipes pour le moment.";
      teamOptions.innerHTML = "";
    }
  }

  function renderTeams(teams) {
    teamOptions.innerHTML = "";
    const selectedSchool = getSelectedSchool();

    const currentSelection = teams.find(function (team) {
      return team.id === selectedTeam;
    });

    if (currentSelection && !currentSelection.allowedSchools.includes(selectedSchool)) {
      selectedTeam = "";
    }

    teams.forEach((team) => {
      const isFull = Number(team.current_count) >= Number(team.max_slots);
      const isBlockedBySchool = !selectedSchool || !team.allowedSchools.includes(selectedSchool);
      const isDisabled = isFull || isBlockedBySchool;

      const wrapper = document.createElement("label");
      wrapper.className = "team-option" + (isDisabled ? " is-full" : "");
      wrapper.setAttribute("aria-disabled", String(isDisabled));

      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "teamId";
      radio.value = team.id;
      radio.disabled = isDisabled;
      radio.required = true;
      radio.addEventListener("change", function () {
        selectedTeam = radio.value;
        const options = teamOptions.querySelectorAll(".team-option");
        options.forEach(function (option) {
          option.classList.remove("is-selected");
        });
        wrapper.classList.add("is-selected");
      });

      wrapper.addEventListener("click", function () {
        if (isDisabled) return;
        radio.checked = true;
        radio.dispatchEvent(new Event("change", { bubbles: true }));
      });

      const name = document.createElement("span");
      name.className = "team-name";
      name.textContent = team.name;

      const count = document.createElement("span");
      count.className = "team-count";
      count.textContent = String(team.current_count) + "/" + String(team.max_slots);

      wrapper.appendChild(radio);
      wrapper.appendChild(name);
      wrapper.appendChild(count);

      if (isFull || isBlockedBySchool) {
        const badge = document.createElement("span");
        badge.className = "team-badge";
        badge.textContent = isFull ? "Complet" : "Indisponible";
        wrapper.appendChild(badge);
      }

      if (selectedTeam === team.id && !isDisabled) {
        wrapper.classList.add("is-selected");
        radio.checked = true;
      }

      teamOptions.appendChild(wrapper);
    });

    teamHelp.textContent = getTeamHelpMessage();
  }

  async function postPrepare(payload) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(function () {
      controller.abort();
    }, 12000);

    try {
      const response = await fetch(apiUrl("/api/register/prepare"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          school: payload.school,
          teamId: payload.teamId,
        }),
        signal: controller.signal,
      });

      const json = await response.json().catch(function () {
        return null;
      });

      if (response.status === 429) {
        return { ok: false, message: "Trop de requetes, reessayez dans une minute." };
      }

      if (response.status === 400 || response.status === 422) {
        return {
          ok: false,
          message:
            json && typeof json.error === "string"
              ? json.error
              : "Veuillez verifier les informations saisies.",
        };
      }

      if (!response.ok) {
        return { ok: false, message: "Une erreur est survenue, reessayez." };
      }

      if (!json || json.ok !== true || !json.data || typeof json.data.redirectUrl !== "string") {
        return { ok: false, message: "Une erreur est survenue, reessayez." };
      }

      return { ok: true, redirectUrl: json.data.redirectUrl };
    } catch (_error) {
      return { ok: false, message: "Une erreur est survenue, reessayez." };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function confirmRegistrationForTest(state, txId) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(function () {
      controller.abort();
    }, 12000);

    try {
      const query = new URLSearchParams({ state: state, txId: txId });
      const response = await fetch(apiUrl("/api/register/confirm?" + query.toString()), {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
        signal: controller.signal,
      });

      const json = await response.json().catch(function () {
        return null;
      });

      if (!response.ok || !json || json.ok !== true) {
        return {
          ok: false,
          message:
            json && typeof json.error === "string"
              ? json.error
              : "La confirmation backend a echoue.",
        };
      }

      return { ok: true };
    } catch (_error) {
      return { ok: false, message: "Impossible de joindre le backend de confirmation." };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    clearError();

    if (!FORM_IS_OPEN) {
      setError(FORM_CLOSED_MESSAGE);
      return;
    }

    const payload = {
      school: schoolInput ? schoolInput.value : "",
      participantType: getSelectedParticipantType(),
      teamId: selectedTeam,
    };

    const validationMessage = validateFields(payload);
    if (validationMessage) {
      setError(validationMessage);
      return;
    }

    setLoading(true);
    const result = await postPrepare(payload);
    setLoading(false);

    if (result.ok) {
      const helloAssoUrl = new URL(result.redirectUrl);
      const state = helloAssoUrl.searchParams.get("state");

      if (!state) {
        setError("State introuvable, impossible de confirmer l inscription.");
        return;
      }

      const txId = "test-" + Date.now();
      const confirmResult = await confirmRegistrationForTest(state, txId);
      if (!confirmResult.ok) {
        setError(confirmResult.message || "La confirmation backend a echoue.");
        return;
      }

      const confirmationUrl = new URL(TEST_CONFIRMATION_URL);
      confirmationUrl.searchParams.set("state", state);
      confirmationUrl.searchParams.set("txId", txId);

      window.location.href = confirmationUrl.toString();
      return;
    }

    setError(result.message || "Une erreur est survenue, reessayez.");
  });

  // Initialise explicitement l'etat du bouton au chargement de la page.
  setLoading(false);

  var profInfoBox = document.getElementById("prof-info");

  if (schoolInput) {
    schoolInput.addEventListener("change", function () {
      clearError();
      updateFormSectionState();
      updateTeamVisibility();
    });
  }

  function updateFormSectionState() {
    var hasSchool = Boolean(getSelectedSchool());
    if (formRest) {
      formRest.disabled = !hasSchool;
    }
  }

  function updateProfInfo() {
    if (profInfoBox) {
      var isProf = getSelectedParticipantType() === "prof";
      profInfoBox.style.display = isProf ? "block" : "none";
    }
  }

  if (participantTypeInputs.length > 0) {
    participantTypeInputs.forEach(function (input) {
      input.addEventListener("change", function () {
        clearError();
        updateTeamVisibility();
        updateProfInfo();
      });
    });
  }

  fetchTeams();
  updateTeamVisibility();
  updateFormSectionState();
})();