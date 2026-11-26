# Connect the 33 Room WhatsApp sender

The intended sender is **070 122 6045**, saved as **+94701226045** in the local backend `.env`. Every selected resident receives their own bill from this sender. Resident numbers are recipients; changing the signed-in administrator does not change the sender.

The local code is prepared, but Meta registration, credentials and template approval are still required. Adding a telephone number to `.env` does not register it with Meta.

## Complete the Meta account setup

1. Connect **+94701226045** as a business phone number on Meta's WhatsApp Business Platform and complete the number verification/registration flow. The appropriate onboarding depends on whether the number currently uses ordinary WhatsApp, the WhatsApp Business app, or Cloud API. Confirm that state before changing the existing account.
2. Copy the **Phone Number ID for +94701226045** into `WHATSAPP_PHONE_NUMBER_ID` in `33-backend/.env`. This is Meta's numeric identifier, not `94701226045` and not the WhatsApp Business Account ID. A Meta test sender would send from its own number and will be rejected by this project's sender check.
3. Set `WHATSAPP_ACCESS_TOKEN` in that same local file. The token must have access to this sender and the necessary WhatsApp management/messaging permissions. Keep the token in the backend environment; do not put it in chat or frontend settings.
4. Submit [monthly-utility-bill-v2.json](monthly-utility-bill-v2.json) / [the exact template body](monthly-utility-bill-v2.txt) in WhatsApp Manager. Wait for **APPROVED** status for the utility template `room33_monthly_utility_bill_v2`, language `en`, with ten positional body parameters. Use the exact approved name/language if Meta requires a different name.

The local configuration already selects this sender and v2 template. `WHATSAPP_ENABLED=true` permits sending once configuration is complete; with the required credentials missing, notices remain pending. Keep sending disabled while completing account setup if credentials are added before approval.

```dotenv
WHATSAPP_ENABLED=true
WHATSAPP_SENDER_PHONE_NUMBER=+94701226045
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_API_VERSION=v22.0
WHATSAPP_TEMPLATE_NAME=room33_monthly_utility_bill_v2
WHATSAPP_TEMPLATE_LANGUAGE=en
WHATSAPP_TEMPLATE_VERSION=2
```

Keep the supported API version selected for your Meta account. The example retains the project's existing version.

## Verify and use

From `33-backend`, run:

```powershell
npm.cmd run whatsapp:check
```

This command reports missing settings or performs a read-only Meta lookup to confirm that the configured Phone Number ID belongs to **+94701226045**. It prints no access token and sends no messages. It does not verify template approval or phone delivery.

After completing setup, restart the backend so it reloads `.env`. In Bill Management, check **Configured WhatsApp sender: +94701226045**. Save a bill with sending selected, or use **Send pending / retry failed** on a saved bill. These actions send real notices to the selected residents.

Before sending, the backend verifies the sender through Meta. A wrong number, rejected credentials or failed lookup prevents the messages from being claimed/sent. Successful sender checks are cached for five minutes; changed credentials require a fresh check. Accepted, processing and uncertain notices are not automatically retried.

Meta references: [sender registration and messaging](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api), [business phone number lookup](https://www.postman.com/meta/whatsapp-business-platform/documentation/3kru5r6/moved-whatsapp-business-management-api?entity=request-13382743-84afa7e3-8734-4854-85b7-560fa31e4141).
