---
"opencode-supabase": patch
---

Fix V2 OAuth refresh dedup dropping its entry too early and keying on the raw broker URL (#90, #91). Keep a successful refresh cached under the consumed old refresh token until the process ends: the OpenCode host persists the rotated credential only after `refresh()` resolves, so a second resolve in that window must converge on the cached result instead of re-sending the single-use token (broker 401). Failed refreshes still delete the entry so waiters are released and a retry reaches the broker. Dedup keys now strip the trailing slash with the same normalization `makeBrokerRequest()` applies, so `https://host/broker` and `https://host/broker/` aliases no longer send the credential twice.
