# Piploy deploys Life while Ollama runs as a Pi host service

Raspberry Pi production uses Piploy to build and run one Life container from `Dockerfile.prod`, with SQLite in a Piploy-managed bind volume, while Ollama runs natively under systemd and is reached through the Docker bridge. This replaces the production Compose stack because Piploy already owns application deployment on the Pi and models an application as one container; `docker-compose.yml` remains the complete local development stack, while Ollama model installation, restart, and resource limits become host responsibilities.
