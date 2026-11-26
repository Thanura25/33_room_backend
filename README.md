# 33 Room API

Express and MongoDB backend for resident management, equal monthly bill splitting, payments and WhatsApp notices.

See [the project setup guide](../README.md) for configuration, the monthly workflow, WhatsApp template requirements and tests. The default WhatsApp mode stores pending messages without sending them.

Set `ADMIN_NAME`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` in this folder's `.env` to manage the initial administrator. Restarting the API creates or updates that account. A blank password preserves an existing account's password; a new account requires one. With admin environment settings supplied, public registration is disabled. Credentials remain on the backend, and MongoDB stores only the password hash.

## API

All routes except health, login and first-account setup require a Bearer JWT. Resident, bill, payment and message mutations require an administrator.

| Method | Route | Purpose |
| --- | --- | --- |
| GET | /api/health | Server health |
| GET | /api/auth/setup | Whether the first administrator needs to be created |
| POST | /api/auth/register | Create the first administrator only |
| POST | /api/auth/login | Sign in |
| GET / POST | /api/residents | List / add residents |
| PUT | /api/residents/:id | Edit a resident |
| GET | /api/dashboard?month=YYYY-MM | Selected month, residents, shares, messages, payments and history |
| PUT | /api/bills/:month | Save an immutable monthly bill and queue/send messages |
| GET | /api/bills/:id | Retrieve saved bill and share rows |
| POST | /api/bills/:id/notifications | Send pending or retry failed bill notices |
| PATCH | /api/allocations/:id/payment | Set cumulative payment and optional adjustments |
| GET | /api/notifications?billId=:id | List stored notifications |

Example bill body:

```json
{
  "electricity": "9000.00",
  "water": "2000.00",
  "sharedCredit": "1000.00",
  "dueDate": "2026-09-30",
  "residentIds": ["resident-object-id-1", "resident-object-id-2"],
  "sendNotifications": true
}
```

The notification endpoint optionally accepts `{ "resident_id": "..." }` for one selected resident. It derives the recipient and message from saved bill data.

The payment endpoint accepts `paidAmount`, `previousBalance`, `manualAdjustment`, `paymentMethod` (`cash`, `bank transfer`, `online payment`) and optional `paidAt`.

Legacy routes `POST /api/bills`, `POST /api/payments` and `POST /api/notifications/send` remain available. New frontend code uses the routes above. The legacy bill endpoint also requires explicit `residentIds`.
