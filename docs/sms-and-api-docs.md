# SMS and API docs

## SMS (OTP codes)

Codes are queued (BullMQ) and sent by `NotificationsProcessor` through the `SmsChannel`. Which gateway is used comes from `.env`:

| Setting | Meaning |
|---|---|
| `SMS_PROVIDER` | `termii`, `emisri` or `console` (print to the log) |
| `SMS_FALLBACK_ENABLED` | `true` → if the chosen gateway fails, the other one is tried |
| `TERMII_API_KEY`, `TERMII_SENDER_ID`, `TERMII_BASE_URL`, `TERMII_CHANNEL` | Termii; `TERMII_CHANNEL=dnd` reaches DND numbers and is the route for OTPs (Termii must enable it on your account), `generic` doesn't |
| `EMISRI_API_KEY`, `EMISRI_SENDER_ID`, `EMISRI_BASE_URL`, `EMISRI_EXCLUDE_DND` | Emisri |

A gateway without its API key and sender ID is skipped. If neither is set up, texts are printed to the log (the server says so at start-up). If every gateway fails, the job fails and the queue retries it (3 attempts).

Start-up logs which route is active, e.g. `Text messages go through termii → then emisri.` Each send logs the gateway and message id with the phone number masked.

### Code layout

```
src/modules/notifications/
  notifications.module.ts        picks the channels from .env
  notifications.service.ts       queues jobs
  notifications.processor.ts     sends them (OTP, password changed, contact)
  channels/
    channel.interfaces.ts        SmsChannel / EmailChannel
    sms/
      sms-provider.ts            SmsProvider interface, SmsProviderError, helpers
      termii.provider.ts         POST {TERMII_BASE_URL}/api/sms/send
      emisri.provider.ts         POST {EMISRI_BASE_URL}/sms/send (X-Emisri-Api-Key)
      gateway-sms.channel.ts     primary → fallback
      console-sms.channel.ts     development
      sms-channel.factory.ts     reads SMS_* / TERMII_* / EMISRI_*
      sms.spec.ts                unit tests (no real texts sent)
    email/
      smtp-email.channel.ts, console-email.channel.ts, email-channel.factory.ts
```

To add another gateway: implement `SmsProvider` in `channels/sms/`, then register it in `sms-channel.factory.ts`.

Tests always use the console channel, so running them never sends real texts.

## Swagger (API docs)

- Interactive docs: **http://localhost:4000/api/docs**
- OpenAPI JSON (import into Postman / Insomnia): **http://localhost:4000/api/docs-json**

On by default except when `NODE_ENV=production`; force it with `SWAGGER_ENABLED=true|false`.

Click **Authorize** and paste an access token (from `POST /api/v1/auth/login`) to try locked routes. Routes marked `@Public()` show without a lock; every route lists the shared `ErrorResponseDto` for its error responses.

When you add an endpoint: put `@ApiTags`, `@ApiOperation({ summary })` and `@ApiOkResponse({ type })` on it, and `@ApiProperty` on DTO fields (the Swagger CLI plugin in `nest-cli.json` fills in the rest from class-validator). `test/swagger.e2e-spec.ts` fails if a route has no tag or summary.

### Checking your SMS setup

```bash
npm run sms:test -- 08031234567                 # SMS_PROVIDER, with fallback if enabled
npm run sms:test -- 08031234567 --only=termii   # just Termii
npm run sms:test -- 08031234567 --only=emisri   # just Emisri
```

It sends one real text with the same code the app uses and prints which gateway delivered it (or why it failed).
