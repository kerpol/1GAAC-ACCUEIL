export type Team = {
  id: string;
  name: string;
  max_slots: number;
  current_count: number;
};

type ApiEnvelope<T> = {
  ok: boolean;
  data?: T;
  error?: string;
};

export type FetchResult<T> = {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
};

export type PrepareRegistrationPayload = {
  fullName: string;
  classroom: string;
  email: string;
  teamId: string;
};

export type PrepareRegistrationData = {
  redirectUrl: string;
};

export type ConfirmRegistrationData = {
  registrationId?: string | number | null;
  teamName?: string | null;
  message?: string | null;
};

type RequestOptions = RequestInit & {
  baseUrl?: string;
};

function buildUrl(path: string, baseUrl?: string) {
  if (!baseUrl) {
    return path;
  }

  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

async function fetchJson<T>(path: string, options: RequestOptions = {}): Promise<FetchResult<T>> {
  const { baseUrl, headers, ...init } = options;

  try {
    const response = await fetch(buildUrl(path, baseUrl), {
      ...init,
      headers: {
        Accept: "application/json",
        ...headers,
      },
    });

    const json = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;
    return {
      ok: response.ok && Boolean(json?.ok),
      status: response.status,
      data: json?.data,
      error: json?.error,
    };
  } catch {
    return {
      ok: false,
      status: 0,
      error: "Le serveur est temporairement inaccessible. Merci de reessayer.",
    };
  }
}

export async function getTeams(options: RequestOptions = {}) {
  return fetchJson<Team[]>("/api/teams", {
    ...options,
    method: "GET",
  });
}

export async function prepareRegistration(payload: PrepareRegistrationPayload, options: RequestOptions = {}) {
  return fetchJson<PrepareRegistrationData>("/api/register/prepare", {
    ...options,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
    body: JSON.stringify(payload),
  });
}

export async function confirmRegistration(
  params: { state: string; txId?: string },
  options: RequestOptions = {},
) {
  const search = new URLSearchParams({ state: params.state });
  if (params.txId) {
    search.set("txId", params.txId);
  }

  return fetchJson<ConfirmRegistrationData>(`/api/register/confirm?${search.toString()}`, {
    ...options,
    method: "GET",
  });
}