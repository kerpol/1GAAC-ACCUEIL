from __future__ import annotations

import os
from threading import Lock
from typing import Any
from urllib.parse import urlencode

from fastapi import FastAPI, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from psycopg import Error as PsycopgError
from psycopg.errors import RaiseException, UndefinedTable, UniqueViolation

from db import get_connection, load_env_file, transaction
from models import ApiResponse, ConfirmResponseData, PrepareBody, PrepareResponseData, TeamItem
from ratelimit import InMemoryRateLimiter
from security import StateTokenError, sign_state, verify_state


load_env_file()

app = FastAPI(title="Tournoi Futsal API", version="1.0.0")
rate_limiter = InMemoryRateLimiter(max_requests=20, window_seconds=60)
SPECIAL_TEAM_CHOICES = {
    "visitor": "Visiteur",
    "teacher": "Prof",
}
SPECIAL_TEAM_MAX_SLOTS = 1000000
FALLBACK_TEAM_MAX_SLOTS = 7
FALLBACK_TEAMS = [
    {"id": "fallback-sacre-1", "name": "équipe sacré-coeur 1", "max_slots": FALLBACK_TEAM_MAX_SLOTS},
    {"id": "fallback-sacre-2", "name": "équipe sacré-coeur 2", "max_slots": FALLBACK_TEAM_MAX_SLOTS},
    {"id": "fallback-cfa", "name": "équipe CFA", "max_slots": FALLBACK_TEAM_MAX_SLOTS},
    {"id": "fallback-freyssinet", "name": "équipe Freyssinet", "max_slots": FALLBACK_TEAM_MAX_SLOTS},
]
FALLBACK_LOCK = Lock()
FALLBACK_COUNT_BY_TEAM: dict[str, int] = {team["id"]: 0 for team in FALLBACK_TEAMS}
FALLBACK_TX_INDEX: dict[str, dict[str, Any]] = {}
FALLBACK_REGISTRATION_SEQ = 0


class ApiError(Exception):
    def __init__(self, status_code: int, message: str) -> None:
        self.status_code = status_code
        self.message = message
        super().__init__(message)


def ok(data: Any, status_code: int = 200) -> JSONResponse:
    payload = ApiResponse(ok=True, data=data)
    return JSONResponse(status_code=status_code, content=payload.model_dump())


def fail(message: str, status_code: int) -> JSONResponse:
    payload = ApiResponse(ok=False, error=message)
    return JSONResponse(status_code=status_code, content=payload.model_dump())


def get_client_ip(request: Request) -> str:
    forwarded_for = request.headers.get("x-forwarded-for", "").strip()
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def enforce_rate_limit(request: Request, route_key: str) -> None:
    ip = get_client_ip(request)
    allowed, retry_after = rate_limiter.allow(f"{ip}:{route_key}")
    if not allowed:
        raise ApiError(
            429,
            f"Trop de requêtes sur cette route. Merci de réessayer dans {retry_after} seconde(s).",
        )


def get_required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"La variable d'environnement {name} est obligatoire.")
    return value


def find_fallback_team_by_identifier(team_identifier: str) -> dict[str, Any] | None:
    needle = team_identifier.strip().lower()
    for team in FALLBACK_TEAMS:
        if team["id"] == team_identifier or team["name"].lower() == needle:
            return dict(team)
    return None


def find_team_by_identifier(team_identifier: str) -> dict[str, Any] | None:
    query = """
        SELECT id::text AS id, name, max_slots
        FROM public.teams
        WHERE id::text = %s OR lower(name) = lower(%s)
        ORDER BY CASE WHEN id::text = %s THEN 0 ELSE 1 END, name
        LIMIT 1
    """
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(query, (team_identifier, team_identifier, team_identifier))
                team = cur.fetchone()
                if team is not None:
                    return team
    except (RuntimeError, PsycopgError):
        # Mode de secours sans base: on retombe sur des équipes statiques.
        return find_fallback_team_by_identifier(team_identifier)

    return find_fallback_team_by_identifier(team_identifier)


def is_special_team_identifier(team_identifier: str) -> bool:
    return team_identifier in SPECIAL_TEAM_CHOICES


def get_or_create_special_team(conn: Any, team_identifier: str) -> dict[str, Any]:
    team_name = SPECIAL_TEAM_CHOICES[team_identifier]
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id::text AS id, name, max_slots
            FROM public.teams
            WHERE lower(name) = lower(%s)
            ORDER BY id
            LIMIT 1
            """,
            (team_name,),
        )
        team = cur.fetchone()

        if team is None:
            cur.execute(
                """
                INSERT INTO public.teams (name, max_slots)
                VALUES (%s, %s)
                RETURNING id::text AS id, name, max_slots
                """,
                (team_name, SPECIAL_TEAM_MAX_SLOTS),
            )
            team = cur.fetchone()

    return team


@app.exception_handler(ApiError)
async def api_error_handler(_: Request, exc: ApiError) -> JSONResponse:
    return fail(exc.message, exc.status_code)


@app.exception_handler(StateTokenError)
async def state_error_handler(_: Request, exc: StateTokenError) -> JSONResponse:
    return fail(str(exc), 400)


@app.exception_handler(RequestValidationError)
async def request_validation_error_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    # Message FR simple pour conserver un format API homogène.
    first = exc.errors()[0] if exc.errors() else None
    if first and isinstance(first, dict):
        field_path = ".".join(str(item) for item in first.get("loc", []) if item != "body")
        if field_path:
            return fail(f"Données invalides pour le champ '{field_path}'.", 422)
    return fail("Données invalides dans la requête.", 422)


@app.exception_handler(Exception)
async def unhandled_error_handler(_: Request, exc: Exception) -> JSONResponse:
    return fail(f"Erreur interne du serveur : {exc}", 500)


site_url = os.getenv("SITE_URL", "").strip()
if site_url:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[site_url],
        allow_credentials=True,
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
    )


@app.get("/api/teams")
def list_teams() -> JSONResponse:
    view_query = """
        SELECT team_id AS id, name, max_slots, current_count
        FROM public.team_with_counts
        ORDER BY name
    """
    fallback_query = """
        SELECT
            t.id::text AS id,
            t.name,
            t.max_slots,
            COUNT(r.id) FILTER (WHERE r.paid = TRUE)::int AS current_count
        FROM public.teams AS t
        LEFT JOIN public.registrations AS r ON r.team_id = t.id
        GROUP BY t.id, t.name, t.max_slots
        ORDER BY t.name
    """

    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                try:
                    cur.execute(view_query)
                except UndefinedTable:
                    cur.execute(fallback_query)
                teams = [TeamItem.model_validate(row).model_dump() for row in cur.fetchall()]
    except (RuntimeError, PsycopgError):
        with FALLBACK_LOCK:
            teams = [
                TeamItem.model_validate(
                    {
                        "id": team["id"],
                        "name": team["name"],
                        "max_slots": team["max_slots"],
                        "current_count": FALLBACK_COUNT_BY_TEAM.get(team["id"], 0),
                    }
                ).model_dump()
                for team in FALLBACK_TEAMS
            ]

    return ok(teams)


@app.get("/api/diagnostic/env")
def diagnostic_env() -> JSONResponse:
    keys = (
        "DATABASE_URL",
        "POSTGRES_URL",
        "POSTGRES_PRISMA_URL",
        "SUPABASE_DB_URL",
        "JWT_STATE_SECRET",
        "SITE_URL",
        "HELLOASSO_CHECKOUT_URL",
    )
    data = {key: bool(os.getenv(key, "").strip()) for key in keys}
    return ok(data)


@app.post("/api/register/prepare")
def prepare_registration(body: PrepareBody, request: Request) -> JSONResponse:
    enforce_rate_limit(request, "/api/register/prepare")

    if is_special_team_identifier(body.teamId):
        team = {"id": body.teamId, "name": SPECIAL_TEAM_CHOICES[body.teamId]}
    else:
        team = find_team_by_identifier(body.teamId)

    if team is None:
        raise ApiError(400, "Équipe introuvable. Vérifiez l'identifiant ou le nom fourni.")

    state = sign_state(
        {
            "teamId": team["id"],
            "teamName": team["name"],
            "email": body.email,
            "fullName": body.fullName,
            "classroom": body.classroom,
        }
    )

    checkout_url = get_required_env("HELLOASSO_CHECKOUT_URL")
    separator = "&" if "?" in checkout_url else "?"
    redirect_url = f"{checkout_url}{separator}{urlencode({'state': state})}"

    data = PrepareResponseData(redirectUrl=redirect_url).model_dump()
    return ok(data)


@app.get("/api/register/confirm")
def confirm_registration(
    request: Request,
    state: str = Query(..., min_length=1),
    txId: str | None = Query(default=None, min_length=1),
) -> JSONResponse:
    enforce_rate_limit(request, "/api/register/confirm")
    payload = verify_state(state)

    def fallback_confirm() -> JSONResponse:
        global FALLBACK_REGISTRATION_SEQ

        if txId:
            existing = FALLBACK_TX_INDEX.get(txId)
            if existing is not None:
                return ok(
                    ConfirmResponseData(
                        registrationId=existing["registrationId"],
                        teamName=existing["teamName"],
                        message="Inscription déjà confirmée (idempotence).",
                    ).model_dump()
                )

        team = find_fallback_team_by_identifier(payload.teamId)
        if team is None:
            if is_special_team_identifier(payload.teamId):
                team = {
                    "id": payload.teamId,
                    "name": SPECIAL_TEAM_CHOICES[payload.teamId],
                    "max_slots": SPECIAL_TEAM_MAX_SLOTS,
                }
            else:
                raise ApiError(400, "Équipe introuvable pour cette confirmation de paiement.")

        with FALLBACK_LOCK:
            current_count = FALLBACK_COUNT_BY_TEAM.get(team["id"], 0)
            if current_count >= int(team.get("max_slots", FALLBACK_TEAM_MAX_SLOTS)):
                raise ApiError(409, "Cette équipe est complète. Merci de choisir une autre équipe.")

            FALLBACK_REGISTRATION_SEQ += 1
            registration_id = f"fallback-{FALLBACK_REGISTRATION_SEQ}"
            FALLBACK_COUNT_BY_TEAM[team["id"]] = current_count + 1

            if txId:
                FALLBACK_TX_INDEX[txId] = {
                    "registrationId": registration_id,
                    "teamName": team["name"],
                }

        return ok(
            ConfirmResponseData(
                registrationId=registration_id,
                teamName=team["name"],
            ).model_dump()
        )

    if txId:
        try:
            with get_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "SELECT id FROM public.registrations WHERE helloasso_tx_id = %s LIMIT 1",
                        (txId,),
                    )
                    existing = cur.fetchone()
                    if existing is not None:
                        return ok(
                            ConfirmResponseData(
                                message="Inscription déjà confirmée (idempotence)."
                            ).model_dump()
                        )
        except (RuntimeError, PsycopgError):
            return fallback_confirm()

    try:
        with transaction() as conn:
            with conn.cursor() as cur:
                is_special_team = is_special_team_identifier(payload.teamId)

                if is_special_team:
                    team = get_or_create_special_team(conn, payload.teamId)
                else:
                    cur.execute(
                        """
                        SELECT id, name, max_slots
                        FROM public.teams
                        WHERE id::text = %s
                        FOR UPDATE
                        """,
                        (payload.teamId,),
                    )
                    team = cur.fetchone()
                    if team is None:
                        raise ApiError(400, "Équipe introuvable pour cette confirmation de paiement.")

                    cur.execute(
                        """
                        SELECT COUNT(*)::int AS current_count
                        FROM public.registrations
                        WHERE team_id = %s AND paid = TRUE
                        """,
                        (team["id"],),
                    )
                    current_count = cur.fetchone()["current_count"]

                    if current_count >= team["max_slots"]:
                        raise ApiError(409, "Cette équipe est complète. Merci de choisir une autre équipe.")

                if txId:
                    cur.execute(
                        "SELECT id FROM public.registrations WHERE helloasso_tx_id = %s LIMIT 1",
                        (txId,),
                    )
                    existing = cur.fetchone()
                    if existing is not None:
                        return ok(
                            ConfirmResponseData(
                                message="Inscription déjà confirmée (idempotence)."
                            ).model_dump()
                        )

                cur.execute(
                    """
                    INSERT INTO public.registrations (
                        team_id,
                        full_name,
                        classroom,
                        email,
                        paid,
                        helloasso_tx_id
                    )
                    VALUES (%s, %s, %s, %s, TRUE, %s)
                    RETURNING id
                    """,
                    (
                        team["id"],
                        payload.fullName,
                        payload.classroom,
                        payload.email,
                        txId,
                    ),
                )
                registration = cur.fetchone()

    except UniqueViolation:
        if txId:
            return ok(
                ConfirmResponseData(
                    message="Inscription déjà confirmée (idempotence)."
                ).model_dump()
            )
        raise ApiError(409, "Une inscription identique existe déjà.")
    except RaiseException as exc:
        raise ApiError(409, f"Inscription refusée par la base : {exc}") from exc
    except ApiError:
        raise
    except (RuntimeError, PsycopgError):
        return fallback_confirm()

    data = ConfirmResponseData(
        registrationId=registration["id"],
        teamName=team["name"],
    ).model_dump()
    return ok(data)