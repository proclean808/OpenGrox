# Web voice cockpit

Browser cockpit for a phone that is already running an MCP endpoint. It does not drive Android by itself.

- A command is VERIFIED only after a real readback from the phone.
- If the phone cannot be checked, the status is UNKNOWN. It is never marked verified from the model's word.
- The key stays in this browser. The server blocks private and loopback addresses, so the phone must be reachable on a public tunnel.

These files are the cockpit source. They are not a second installable app, and they do not replace `frontend/` (the Expo shell) or `backend/` (the existing API).
