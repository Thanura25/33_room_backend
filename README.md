# 33 Room API

Express and MongoDB backend for resident management, equal monthly bill splitting, payments and WhatsApp notices.

See [the project setup guide](../README.md) for configuration, the monthly workflow, WhatsApp template requirements and tests. The default WhatsApp mode stores pending messages without sending them.

Set `ADMIN_NAME`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` in this folder's `.env` to manage the initial administrator. Restarting the API creates or updates that account. A blank password preserves an existing account's password; a new account requires one. With admin environment settings supplied, public registration is disabled. Credentials remain on the backend, and MongoDB stores only the password hash.
