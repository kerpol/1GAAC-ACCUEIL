# Backend tournoi futsal

Backend FastAPI pour gérer les inscriptions d'un tournoi de futsal au lycée, avec paiement HelloAsso et confirmation d'inscription uniquement après retour de paiement.

## Arborescence

```text
.
├── .env.example
├── README.md
├── app.py
├── db.py
├── docker-compose.yml
├── models.py
├── ratelimit.py
├── requirements.txt
└── security.py
```

## Prérequis

- Python 3.11+
- Une base PostgreSQL accessible avec le schéma déjà appliqué
- Les variables d'environnement décrites dans `.env.example`

## Installation

```bash
pip install -r requirements.txt
cp .env.example .env
```

Complétez ensuite le fichier `.env` avec vos vraies valeurs.

## Configuration

Variables obligatoires :

- `DATABASE_URL` : URL PostgreSQL complète
- `JWT_STATE_SECRET` : secret HS256 pour signer le paramètre `state`
- `SITE_URL` : URL publique du frontend
- `HELLOASSO_CHECKOUT_URL` : URL de checkout HelloAsso

## Lancement

```bash
uvicorn app:app --reload
```

API disponible par défaut sur `http://127.0.0.1:8000`.

## Endpoints

### GET /api/teams

Retourne la liste des équipes avec :

- `id`
- `name`
- `max_slots`
- `current_count`

Le backend tente d'abord d'utiliser la vue `public.team_with_counts`. Si elle n'existe pas, il calcule les compteurs avec un `LEFT JOIN`.

### POST /api/register/prepare

Body JSON attendu :

```json
{
  "fullName": "Jean Dupont",
  "classroom": "TSTI2D",
  "email": "jean.dupont@example.com",
  "teamId": "Equipe Rouge"
}
```

Comportement :

- valide les champs via Pydantic
- vérifie l'existence de l'équipe par identifiant ou par nom
- génère un JWT `state` valable 2 heures
- renvoie l'URL de redirection HelloAsso
- n'écrit rien en base et ne réserve aucune place

### GET /api/register/confirm

Query params :

- `state` obligatoire
- `txId` optionnel

Comportement :

- valide le JWT `state`
- verrouille l'équipe avec `SELECT ... FOR UPDATE`
- vérifie le quota courant des inscriptions payées
- gère l'idempotence si `txId` existe déjà
- insère l'inscription avec `paid = TRUE`

## Notes HelloAsso

- Configurez la redirection post-paiement vers : `${SITE_URL}/confirmation`
- Le frontend lit `state` et `txId` dans l'URL de retour HelloAsso
- Le frontend appelle ensuite `GET /api/register/confirm` côté backend
- La sélection de pizza reste côté HelloAsso et ne passe pas par ce backend

## Dépannage

- Erreurs de DB : vérifiez `DATABASE_URL`
- Réponse `409` : l'équipe est complète ou une contrainte de concurrence a été déclenchée
- Réponse `429` : la limite de requêtes par IP a été atteinte
- JWT expiré : relancez l'inscription en refaisant `POST /api/register/prepare`

## Exemples cURL

### Liste des équipes

```bash
curl http://127.0.0.1:8000/api/teams
```

### Préparer une inscription

```bash
curl -X POST http://127.0.0.1:8000/api/register/prepare \
  -H "Content-Type: application/json" \
  -d '{
    "fullName": "Jean Dupont",
    "classroom": "TSTI2D",
    "email": "jean.dupont@example.com",
    "teamId": "Equipe Rouge"
  }'
```

### Confirmer une inscription

```bash
curl "http://127.0.0.1:8000/api/register/confirm?state=VOTRE_JWT&txId=HELLOASSO_TX_123"
```

## Remarques de sécurité

- Le paramètre `state` est signé en HS256 et expire au bout de 2 heures
- Le rate limit mémoire protège `/api/register/prepare` et `/api/register/confirm`
- L'inscription n'est créée qu'au retour de paiement
- Le quota final reste protégé par la transaction applicative et le trigger SQL déjà en base