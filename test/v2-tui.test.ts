import { describe, expect, mock, test } from "bun:test";
import type { Context } from "@opencode/plugin/tui/plugin";
import { setupV2Tui } from "../src/tui/v2.tsx";

function fixture(accounts: { type: string; id: string; label: string }[] = []) {
  let command: { run: () => Promise<void> } | undefined;
  const select = mock(async () => "continue");
  const confirm = mock(async () => true);
  const show = mock((_render: unknown, _close: unknown) => undefined);
  const attempt = { attemptID: "attempt-A", url: "https://example.com/oauth", time: { expires: Date.now() + 300000 } };
  const connect = mock(async (_input: unknown) => ({ data: attempt }));
  const cancel = mock(async (_input: unknown) => undefined);
  const status = mock(async () => ({ data: { status: "complete" } }));
  const prompt = mock(async (_input: unknown) => undefined);
  const remove = mock(async (_input: unknown) => undefined);
  const activate = mock(async (_input: unknown) => undefined);
  const open = mock(async (_url: string) => undefined);
  const toast = mock(() => undefined);
  const ctx = {
    location: { directory: "/project-A" },
    keymap: { layer: (f: () => { mode: string; commands: typeof command[] }) => {
      const layer = f();
      expect(layer.mode).toBe("global");
      command = layer.commands[0];
    } },
    client: {
      integration: { get: async () => ({ data: { connections: accounts } }), oauth: { connect, status, cancel } },
      credential: { remove, activate },
      session: { prompt },
    },
    ui: { dialog: { select, confirm, show, clear() {}, set() {}, alert: async () => undefined },
      toast: { show: toast }, router: { current: () => ({ type: "session", sessionID: "session-A" }) } },
  } as unknown as Context;
  const dispose = setupV2Tui(ctx, open);
  if (!command) throw new Error("Missing /supabase command");
  return { command, dispose, select, confirm, show, connect, cancel, status, prompt, remove, activate, open, toast };
}

describe("V2 /supabase", () => {
  test("starts OAuth in the captured Location and onboards only after completion", async () => {
    const f = fixture();
    await f.command.run();
    expect(f.connect.mock.calls[0]?.[0]).toMatchObject({ integrationID: "supabase", methodID: "supabase", location: { directory: "/project-A" } });
    expect(f.open.mock.calls[0]?.[0]).toBe("https://example.com/oauth");
    expect(f.prompt.mock.calls[0]?.[0]).toMatchObject({ sessionID: "session-A", resume: false });
    expect(f.cancel).not.toHaveBeenCalled();
    await f.dispose();
  });

  test("existing connections preserve once-per-session onboarding", async () => {
    const f = fixture([{ type: "credential", id: "account-A", label: "Account A" }]);
    await f.command.run();
    await f.command.run();
    expect(f.prompt).toHaveBeenCalledTimes(1);
    expect(f.connect).not.toHaveBeenCalled();
    await f.dispose();
  });

  test("account selection and disconnect affect only the chosen host credential", async () => {
    const f = fixture([{ type: "credential", id: "account-A", label: "Account A" }, { type: "credential", id: "account-B", label: "Account B" }]);
    f.select.mockResolvedValueOnce("choose").mockResolvedValueOnce("account-B");
    await f.command.run();
    expect(f.activate.mock.calls[0]?.[0]).toEqual({ credentialID: "account-B" });
    f.select.mockResolvedValueOnce("disconnect").mockResolvedValueOnce("account-A");
    f.confirm.mockResolvedValueOnce(false);
    await f.command.run();
    expect(f.remove).not.toHaveBeenCalled();
    f.select.mockResolvedValueOnce("disconnect").mockResolvedValueOnce("account-A");
    await f.command.run();
    expect(f.remove.mock.calls[0]?.[0]).toEqual({ credentialID: "account-A" });
    await f.dispose();
  });

  test("failure cancels the exact attempt and does not onboard", async () => {
    const f = fixture();
    f.status.mockRejectedValueOnce(new Error("callback failed"));
    await f.command.run();
    expect(f.cancel.mock.calls[0]?.[0]).toEqual({ integrationID: "supabase", attemptID: "attempt-A", location: { directory: "/project-A" } });
    expect(f.prompt).not.toHaveBeenCalled();
    expect(f.toast).toHaveBeenCalled();
    await f.dispose();
  });

  test("dispose during authorization cancels without opening a browser or dialog", async () => {
    const f = fixture();
    const deferred = Promise.withResolvers<Awaited<ReturnType<typeof f.connect>>>();
    f.connect.mockImplementationOnce(() => deferred.promise);
    const running = f.command.run();
    for (let tick = 0; tick < 10 && !f.connect.mock.calls.length; tick++) await Promise.resolve();
    expect(f.connect).toHaveBeenCalledTimes(1);
    await f.dispose();
    deferred.resolve({ data: { attemptID: "attempt-A", url: "https://example.com/oauth", time: { expires: Date.now() + 300000 } } });
    await running;
    expect(f.open).not.toHaveBeenCalled();
    expect(f.show).not.toHaveBeenCalled();
    expect(f.cancel).toHaveBeenCalledTimes(1);
  });
});
