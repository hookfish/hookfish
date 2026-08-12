---
"hookfish": patch
---

Remove the generated `hookfish.project.json` marker and make `hookfish dev` and
`hookfish serve` consistently serve the packaged dashboard with an API proxy.
Serving now requires an explicit `--backend-url` or `HOOKFISH_BACKEND_URL`.
