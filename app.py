from __future__ import annotations

import os
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


def find_team_by_identifier(team_identifier: str) -> dict[str, Any] | None:
    query = """
        SELECT id::text AS id, name, max_slots
        FROM public.teams
        WHERE id::text = %s OR lower(name) = lower(%s)
        ORDER BY CASE WHEN id::text = %s THEN 0 ELSE 1 END, name
        LIMIT 1
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(query, (team_identifier, team_identifier, team_identifier))
            return cur.fetchone()


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


@app.on_event("startup")
async def startup_checks() -> None:
    # Keep startup resilient: only DB is required for read endpoints like /api/teams.
    # Payment-related variables are validated lazily on their dedicated routes.
    get_required_env("DATABASE_URL")


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

    with get_connection() as conn:
        with conn.cursor() as cur:
            try:
                cur.execute(view_query)
            except UndefinedTable:
                cur.execute(fallback_query)
            teams = [TeamItem.model_validate(row).model_dump() for row in cur.fetchall()]

    return ok(teams)


@app.post("/api/register/prepare")
def prepare_registration(body: PrepareBody, request: Request) -> JSONResponse:
    enforce_rate_limit(request, "/api/register/prepare")

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

    if txId:
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

    try:
        with transaction() as conn:
            with conn.cursor() as cur:
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
    except PsycopgError as exc:
        raise ApiError(500, f"Erreur de base de données : {exc}") from exc

    data = ConfirmResponseData(
        registrationId=registration["id"],
        teamName=team["name"],
    ).model_dump()
    return ok(data)