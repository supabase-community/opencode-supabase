# Configuration

Most users do not need custom configuration. Install the plugin and run `/supabase` first.

## Disable Bundled Skills

Disable all bundled Supabase skills if you only want plugin tools:

```json
{
  "plugin": [
    ["opencode-supabase", { "skills": false }]
  ]
}
```

## Disable One Bundled Skill

Set a bundled skill name to `false`. Omitted skills stay enabled.

```json
{
  "plugin": [
    ["opencode-supabase", {
      "skills": {
        "supabase-postgres-best-practices": false
      }
    }]
  ]
}
```

Known bundled skills:

- `supabase`
- `supabase-postgres-best-practices`
- `opencode-supabase-guide`

Unknown keys are ignored with a warning.

## OAuth Broker Overrides

Defaults work for normal installs. Maintainers and local broker testers can override:

- `OPENCODE_SUPABASE_OAUTH_CLIENT_ID`
- `OPENCODE_SUPABASE_BROKER_URL`
- `SUPABASE_OAUTH_AUTHORIZE_URL`
- `SUPABASE_API_BASE_URL`

Plugin options with the same purpose are also supported: `clientId`, `brokerBaseUrl`, `authorizeUrl`, and `apiBaseUrl`.

## OAuth Callback URLs

The plugin uses this fixed localhost callback window:

- `http://localhost:14589/auth/callback`
- `http://localhost:14590/auth/callback`
- `http://localhost:14591/auth/callback`

The deployed Supabase OAuth app must allow all three redirect URIs. If these ports change in code, update the OAuth app and broker docs at the same time.
