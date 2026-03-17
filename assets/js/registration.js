(function () {
  const form = document.getElementById("inscription-form");
  if (!form) return;

  // En local, le frontend statique tourne sur :8000 et l'API sur :8001.
  // En production avec reverse-proxy, laisser vide permet d'utiliser le meme host.
  const API_BASE_URL = window.location.port === "8000" ? "http://127.0.0.1:8001" : "";
  function apiUrl(path) {
    return API_BASE_URL ? API_BASE_URL + path : path;
  }

  const fullNameInput = document.getElementById("fullName");
  const classroomInput = document.getElementById("classroom");
  const emailInput = document.getElementById("email");
  const teamOptions = document.getElementById("team-options");
  const teamHelp = document.getElementById("team-help");
  const errorBox = document.getElementById("form-error");
  const submitButton = document.getElementById("validate-pay-btn");
  const submitLabel = document.getElementById("validate-pay-label");

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  let selectedTeam = "";

  function setError(message) {
    errorBox.textContent = message;
    errorBox.focus();
  }

  function clearError() {
    errorBox.textContent = "";
  }

  function setLoading(isLoading) {
    submitButton.disabled = isLoading;
    submitButton.setAttribute("aria-busy", String(isLoading));
    submitLabel.textContent = isLoading ? "Traitement..." : "Valider et payer";
  }

  function validateFields(payload) {
    if (!payload.fullName.trim()) return "Veuillez renseigner votre nom.";
    if (!payload.classroom.trim()) return "Veuillez renseigner votre classe.";
    if (!payload.email.trim()) return "Veuillez renseigner votre email.";
    if (!EMAIL_RE.test(payload.email.trim())) return "Email invalide.";
    if (!payload.teamId) return "Veuillez selectionner une equipe.";
    return null;
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

      renderTeams(json.data);
      teamHelp.textContent = "Choisis une equipe disponible.";
    } catch (_error) {
      teamHelp.textContent = "Impossible de charger les equipes pour le moment.";
      teamOptions.innerHTML = "";
    }
  }

  function renderTeams(teams) {
    teamOptions.innerHTML = "";

    teams.forEach((team) => {
      const isFull = Number(team.current_count) >= Number(team.max_slots);

      const wrapper = document.createElement("label");
      wrapper.className = "team-option" + (isFull ? " is-full" : "");
      wrapper.setAttribute("aria-disabled", String(isFull));

      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "teamId";
      radio.value = team.id;
      radio.disabled = isFull;
      radio.required = true;
      radio.addEventListener("change", function () {
        selectedTeam = radio.value;
      });

      const name = document.createElement("span");
      name.className = "team-name";
      name.textContent = team.name;

      const count = document.createElement("span");
      count.className = "team-count";
      count.textContent = team.current_count + "/" + team.max_slots;

      wrapper.appendChild(radio);
      wrapper.appendChild(name);
      wrapper.appendChild(count);

      if (isFull) {
        const badge = document.createElement("span");
        badge.className = "team-badge";
        badge.textContent = "Complet";
        wrapper.appendChild(badge);
      }

      teamOptions.appendChild(wrapper);
    });
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
        body: JSON.stringify(payload),
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

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    clearError();

    const payload = {
      fullName: fullNameInput.value,
      classroom: classroomInput.value,
      email: emailInput.value,
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
      window.location.href = result.redirectUrl;
      return;
    }

    setError(result.message || "Une erreur est survenue, reessayez.");
  });

  fetchTeams();
})();