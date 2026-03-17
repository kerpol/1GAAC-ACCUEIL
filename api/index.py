"""
Vercel Serverless Function entry point.
Routes all /api/* requests to the FastAPI app.
"""
import sys
from pathlib import Path

# Add the project root to the Python path so imports work
project_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(project_root))

# Import the FastAPI app (this is what Vercel looks for)
from app import app

# Vercel expects a callable named 'app' or 'handler'
# FastAPI is ASGI-compatible, so Vercel handles it automatically
