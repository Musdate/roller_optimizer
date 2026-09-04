#!/usr/bin/env bash
set -e
# Arranca backend (:8000) y frontend (:5173).
trap "kill 0" EXIT
(cd backend && ../.venv/Scripts/python -m uvicorn app.main:app --port 8000 --reload) &
(cd frontend && npm run dev) &
wait
