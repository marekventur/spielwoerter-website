# Spielwoerter.de Partner API

This API allows trusted partner sites to submit word suggestions programmatically. It is intended for machine-to-machine use and requires a pre-shared API key.

---

## Authentication

Include your API key in every request as an HTTP header:

```
X-API-Key: your-api-key-here
```

If the key is missing or unrecognised, you will receive a `401` response:

```json
{ "error": "Invalid API key" }
```

Contact the Spielwoerter.de team to obtain a key.

---

## Endpoint

```
POST https://spielwoerter.de/api/partner/suggestions
Content-Type: application/json
X-API-Key: <your-key>
```

Accepts a batch of up to 100 suggestions in a single request. Each suggestion is evaluated independently — a problem with one entry does not affect the others.

---

## Request Body

```json
{
  "suggestions": [
    {
      "word": "beispiel",
      "action": "upsert",
      "author_email": "user@wortopia.de",
      "payload": {
        "description": "Ein typisches Beispielwort",
        "base": "beispiel"
      },
      "supporters": ["alice@wortopia.de", "bob@wortopia.de"],
      "opposers": []
    },
    {
      "word": "schlechteswort",
      "action": "remove",
      "author_email": "user@wortopia.de",
      "supporters": ["alice@wortopia.de", "bob@wortopia.de", "carol@wortopia.de"],
      "opposers": []
    }
  ]
}
```

### Top-level fields

| Field | Type | Required | Description |
|---|---|---|---|
| `suggestions` | array | yes | 1–100 suggestion objects. |

### Per-suggestion fields

| Field | Type | Required | Description |
|---|---|---|---|
| `word` | string | yes | The word to act on. Case-insensitive — stored lowercase. Max 100 chars. |
| `action` | string | yes | `"upsert"` or `"remove"`. See below. |
| `author_email` | string | yes | Email of the user who authored the suggestion on your site. Used to link to or create a Spielwoerter.de account. |
| `payload` | object | see below | Word metadata. Required when `action` is `"upsert"`. |
| `payload.description` | string | no | Human-readable description of the word. Max 500 chars. |
| `payload.base` | string | no | Base/lemma form of the word (lowercase). Max 100 chars. Omit if same as `word`. |
| `supporters` | array of strings | no | Emails of users on your site who support this suggestion. Max 50. |
| `opposers` | array of strings | no | Emails of users on your site who oppose this suggestion. Max 50. |

### Actions

| Action | Behaviour |
|---|---|
| `upsert` | Adds the word if it is not yet in the list. Updates its description/base if it already exists. |
| `remove` | Proposes removal of the word from the list. |

### Validation rules

- `author_email` must not appear in `supporters` or `opposers`.
- An email address must not appear in both `supporters` and `opposers`.
- For `upsert` on an existing word, at least one of `payload.description` or `payload.base` must be provided.

---

## How suggestions are processed

The outcome depends on the **net support** of the suggestion:

```
net_support = len(supporters) - len(opposers)
```

| net_support | Result |
|---|---|
| ≥ 2 | Suggestion is **automatically approved** and will be applied in the next sync (typically within 60 minutes). If another in-flight suggestion exists for the same word and action, it is superseded. |
| < 2 | Suggestion enters the **moderation queue** for human review. |

Suggestions submitted via this API are never held in a draft state — they bypass the 60-minute draft window used by the web UI.

The suggestion author will receive an email notification when their suggestion is approved or rejected, through the same notification system as the web UI.

---

## Response

**HTTP 200** is returned as long as the request envelope is valid (correct auth, well-formed array). Results for each suggestion are returned in the same order as the input.

```json
{
  "results": [
    {
      "word": "beispiel",
      "action": "upsert",
      "status": "moderator_approved",
      "id": 1234
    },
    {
      "word": "andereswort",
      "action": "upsert",
      "status": "pending_review",
      "id": 1235
    },
    {
      "word": "konflikt",
      "action": "remove",
      "status": "skipped",
      "reason": "conflict"
    },
    {
      "word": "toolong_toolong_toolong_toolong_toolong_toolong_toolong_toolong_toolong_toolong_toolong_toolong_toolong",
      "action": "upsert",
      "status": "error",
      "reason": "word exceeds 100 characters"
    }
  ]
}
```

### Result `status` values

| Status | Meaning |
|---|---|
| `moderator_approved` | Net supporters ≥ 2. Will be applied on the next sync cycle. |
| `pending_review` | Net supporters < 2. Entered the human moderation queue. |
| `skipped` | Not submitted. See `reason`. |
| `error` | Validation failed. See `reason`. |

### `reason` values (for `skipped` and `error`)

| Reason | Meaning |
|---|---|
| `conflict` | An in-flight suggestion from another user already exists for this word and action, and net support is < 2. |
| `blocked` | This word/action combination was previously rejected and is blocked from resubmission. |
| `word is required` | `word` field was missing or empty. |
| `word exceeds 100 characters` | Word is too long. |
| `action must be 'upsert' or 'remove'` | Invalid action value. |
| `author_email is required and must be a valid email` | Email missing or malformed. |
| `author_email must not appear in supporters or opposers` | Author cannot vote on their own suggestion. |
| `an email appears in both supporters and opposers` | Same address on both sides. |
| `supporters/opposers may not exceed 50 entries each` | Too many voters. |
| `description exceeds 500 characters` | Description too long. |
| `base exceeds 100 characters` | Base form too long. |
| `payload must include description or base for upsert` | At least one payload field is required when upserting an existing word. |

---

## Envelope-level errors

These are returned when the entire request fails (rather than individual suggestions):

| HTTP | Body | Cause |
|---|---|---|
| `400` | `{ "error": "'suggestions' must be a non-empty array" }` | Missing or empty `suggestions` field. |
| `400` | `{ "error": "'suggestions' array exceeds maximum of 100 items" }` | Batch too large. |
| `401` | `{ "error": "Invalid API key" }` | Missing or unrecognised `X-API-Key`. |

---

## Example: curl

```bash
curl -X POST https://spielwoerter.de/api/partner/suggestions \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-key-here" \
  -d '{
    "suggestions": [
      {
        "word": "zugzwang",
        "action": "upsert",
        "author_email": "editor@wortopia.de",
        "payload": {
          "description": "Zwang, einen nachteiligen Zug machen zu müssen"
        },
        "supporters": ["user1@wortopia.de", "user2@wortopia.de"],
        "opposers": []
      }
    ]
  }'
```
