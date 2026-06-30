import { expect, test } from "bun:test";

import { HTML_SUCCESS } from "../src/server/auth-html.ts";
import serverModule from "../src/server/index.ts";
import { createSupabaseCommand } from "../src/tui/commands.ts";
import { SupabaseDialog, runAuthFlow, runAuthPreflight } from "../src/tui/dialog.tsx";
import tuiModule from "../src/tui/index.tsx";

type LogEntry = Record<string, unknown>;

function createLogger(logs?: LogEntry[]) {
  if (!logs) {
    return {
      debug: () => Promise.resolve(),
      info: () => Promise.resolve(),
      warn: () => Promise.resolve(),
      error: () => Promise.resolve(),
    };
  }

  return {
    debug: async (message: string, extra?: Record<string, unknown>) => {
      logs.push({ level: "debug", message, extra });
    },
    info: async (message: string, extra?: Record<string, unknown>) => {
      logs.push({ level: "info", message, extra });
    },
    warn: async (message: string, extra?: Record<string, unknown>) => {
      logs.push({ level: "warn", message, extra });
    },
    error: async (message: string, extra?: Record<string, unknown>) => {
      logs.push({ level: "error", message, extra });
    },
  };
}

function createDialogApi(overrides?: Record<string, unknown>) {
  let cleared = 0;
  let replaced = 0;
  const dialogs: unknown[] = [];
  const dialogAlerts: unknown[] = [];
  const dialogConfirms: unknown[] = [];
  const toasts: Array<{ variant?: string; message: string }> = [];
  const promptOps: Array<{ op: string; payload?: unknown }> = [];
  const sessionOps: Array<{ op: string; payload?: unknown }> = [];
  const routeOps: Array<{ op: string; name: string; params?: unknown }> = [];
  const setSizes: string[] = [];
  let openCalls: string[] = [];

  const api = {
    route: {
      current: {
        name: "home",
      },
      navigate: (name: string, params?: unknown) => {
        routeOps.push({ op: "navigate", name, params });
      },
    },
    ui: {
      Dialog: (input: unknown) => {
        dialogs.push(input);
        return input;
      },
      DialogAlert: (input: unknown) => {
        dialogAlerts.push(input);
        return input;
      },
      DialogConfirm: (input: unknown) => {
        dialogConfirms.push(input);
        return input;
      },
      toast: (input: { variant?: string; message: string }) => {
        toasts.push(input);
      },
      dialog: {
        replace: () => {
          replaced += 1;
        },
        clear: () => {
          cleared += 1;
        },
        setSize: (size: string) => {
          setSizes.push(size);
        },
      },
    },
    client: {
      app: {
        log: (_input: unknown) => Promise.resolve(true),
      },
      tui: {
        clearPrompt: () => {
          promptOps.push({ op: "clearPrompt" });
          return Promise.resolve({ data: true });
        },
        appendPrompt: (input: unknown) => {
          promptOps.push({ op: "appendPrompt", payload: input });
          return Promise.resolve({ data: true });
        },
        submitPrompt: () => {
          promptOps.push({ op: "submitPrompt" });
          return Promise.resolve({ data: true });
        },
      },
      session: {
        create: (input?: unknown) => {
          sessionOps.push({ op: "create", payload: input });
          return Promise.resolve({ data: { id: "session-created" } });
        },
        prompt: (input: unknown) => {
          sessionOps.push({ op: "prompt", payload: input });
          return Promise.resolve({ data: true });
        },
        promptAsync: (input: unknown) => {
          sessionOps.push({ op: "promptAsync", payload: input });
          return Promise.resolve({ data: true });
        },
      },
      provider: {
        oauth: {
          authorize: () => Promise.resolve({ data: { url: "https://example.com/auth", instructions: "Test", method: "manual" } }),
          callback: () => Promise.resolve({ data: true }),
        },
      },
    },
    __test: {
      dialogs,
      dialogAlerts,
      dialogConfirms,
      toasts,
      promptOps,
      sessionOps,
      routeOps,
      setSizes,
      get cleared() {
        return cleared;
      },
      get replaced() {
        return replaced;
      },
      get openCalls() {
        return openCalls;
      },
      set openCalls(value: string[]) {
        openCalls = value;
      },
    },
  };

  return Object.assign(api, overrides) as typeof api & {
    __test: {
      dialogs: unknown[];
      dialogAlerts: unknown[];
      dialogConfirms: unknown[];
      toasts: Array<{ variant?: string; message: string }>;
      promptOps: Array<{ op: string; payload?: unknown }>;
      sessionOps: Array<{ op: string; payload?: unknown }>;
      routeOps: Array<{ op: string; name: string; params?: unknown }>;
      setSizes: string[];
      cleared: number;
      replaced: number;
      openCalls: string[];
    };
  };
}

test("server plugin exports supabase id and server hook", () => {
  expect(serverModule.id).toBe("supabase");
  expect(typeof serverModule.server).toBe("function");
});

test("supabase command exposes the expected slash metadata", () => {
  let opened = 0;

  const command = createSupabaseCommand(() => {
    opened += 1;
  });

  expect(command?.title).toBe("Connect to Supabase");
  expect(command?.value).toBe("supabase.connect");
  expect(command?.slash).toEqual({ name: "supabase" });

  const onSelect = command?.onSelect as (() => void) | undefined;
  expect(typeof onSelect).toBe("function");
  onSelect?.();
  expect(opened).toBe(1);
});

test("tui plugin registers /supabase and opens a closable dialog", async () => {
  let commandsFactory: (() => Array<Record<string, unknown>>) | undefined;
  let replaceFactory: (() => unknown) | undefined;
  let cleared = 0;
  let usedCustomDialog = false;
  const setSizes: string[] = [];

  await tuiModule.tui(
    {
      command: {
        register: (factory: () => Array<Record<string, unknown>>) => {
          commandsFactory = factory;
          return () => {};
        },
      },
      ui: {
        Dialog: (input: unknown) => {
          usedCustomDialog = true;
          return input;
        },
        DialogAlert: (input: unknown) => input,
        DialogConfirm: (input: unknown) => input,
        dialog: {
          replace: (factory: () => unknown) => {
            replaceFactory = factory;
          },
          clear: () => {
            cleared += 1;
          },
          setSize: (size: string) => {
            setSizes.push(size);
          },
        },
        toast: () => {},
      },
      client: {
        provider: {
          oauth: {
            authorize: () => Promise.resolve({ data: { url: "https://example.com/auth", instructions: "Test", method: "auto" } }),
            callback: () => Promise.resolve({ data: true }),
          },
        },
      },
    } as never,
    undefined,
    {} as never,
  );

  expect(typeof commandsFactory).toBe("function");

  const commands = commandsFactory?.();
  expect(commands).toHaveLength(1);

  const command = commands?.[0] as { slash?: { name?: string }; onSelect?: () => void } | undefined;
  expect(command?.slash?.name).toBe("supabase");

  command?.onSelect?.();
  expect(typeof replaceFactory).toBe("function");

  expect(typeof replaceFactory).toBe("function");
  const rendered = replaceFactory?.();
  expect(typeof rendered).toBe("function");
  expect(setSizes).toEqual(["medium"]);
  expect(usedCustomDialog).toBe(false);
  expect(cleared).toBe(0);
});

test("supabase dialog shows toast without onboarding after waiting dialog was dismissed", async () => {
  let currentDialog: unknown;
  let currentDialogOnClose: (() => void) | undefined;
  let releaseCallback!: () => void;

  const api = createDialogApi({
    route: {
      current: {
        name: "session",
        params: { sessionID: "session-current" },
      },
      navigate: () => undefined,
    },
    ui: {
      Dialog: (input: unknown) => input,
      DialogAlert: (input: unknown) => {
        currentDialog = input;
        return input;
      },
      DialogConfirm: (input: unknown) => {
        currentDialog = input;
        return input;
      },
      toast: (input: { variant?: string; message: string }) => {
        api.__test.toasts.push(input);
      },
      dialog: {
        replace: (factory: () => unknown, onClose?: () => void) => {
          currentDialog = factory();
          currentDialogOnClose = onClose;
        },
        clear: () => undefined,
        setSize: (size: string) => {
          api.__test.setSizes.push(size);
        },
      },
    },
    client: {
      app: {
        log: (_input: unknown) => Promise.resolve(true),
      },
      tui: {
        clearPrompt: () => Promise.resolve({ data: true }),
        appendPrompt: (_input: unknown) => Promise.resolve({ data: true }),
        submitPrompt: () => Promise.resolve({ data: true }),
      },
      session: {
        promptAsync: (input: unknown) => {
          api.__test.sessionOps.push({ op: "promptAsync", payload: input });
          return Promise.resolve({ data: true });
        },
      },
      provider: {
        oauth: {
          authorize: () => Promise.resolve({ data: { url: "https://example.com/auth", instructions: "Test", method: "manual" } }),
          callback: () =>
            new Promise((resolve) => {
              releaseCallback = () => resolve({ data: true });
            }),
        },
      },
    },
  });
  const lifecycle = { closed: false, dismissed: false };

  const dialog = SupabaseDialog({
    api: api as never,
    logger: createLogger(),
    onClose: () => api.ui.dialog.clear(),
    initialState: { type: "idle" },
    lifecycle,
  }) as { onConfirm?: () => Promise<void> };

  const authPromise = dialog.onConfirm?.();
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(api.__test.setSizes).toContain("large");
  expect(api.__test.dialogs).toHaveLength(0);
  expect(currentDialog).toBeDefined();
  ((currentDialog as { onClose?: () => void }).onClose ?? currentDialogOnClose)?.();
  expect(lifecycle.dismissed).toBe(true);

  releaseCallback();
  await authPromise;

  expect(api.__test.sessionOps.filter((op) => op.op === "promptAsync")).toHaveLength(0);
  expect(api.__test.toasts).toEqual([{ message: "Supabase connected" }]);
});

test("supabase auth retry clears dismissed state", async () => {
  const api = createDialogApi({
    route: {
      current: {
        name: "session",
        params: { sessionID: "session-current" },
      },
      navigate: () => undefined,
    },
  });
  const lifecycle = { closed: false, dismissed: true };

  const dialog = SupabaseDialog({
    api: api as never,
    logger: createLogger(),
    onClose: () => api.ui.dialog.clear(),
    initialState: { type: "idle" },
    lifecycle,
  }) as { onConfirm?: () => Promise<void> };

  await dialog.onConfirm?.();

  expect(lifecycle.dismissed).toBe(false);
  expect(api.__test.toasts).toEqual([]);
  expect(api.__test.sessionOps.filter((op) => op.op === "prompt")).toHaveLength(1);
});

test("supabase dialog success closes without inserting an example prompt", async () => {
  const states: Array<Record<string, unknown>> = [];
  const api = createDialogApi();

  await runAuthFlow({
    api: api as never,
    logger: createLogger(),
    onSuccess: () => {},
    setState: (state) => {
      states.push(state as unknown as Record<string, unknown>);
    },
  });

  const successDialog = SupabaseDialog({
    api: api as never,
    logger: createLogger(),
    onClose: () => api.ui.dialog.clear(),
    initialState: { type: "success" },
  }) as { title?: string; message?: string; onConfirm?: () => Promise<void> };

  expect(successDialog.title).toBe("Connected to Supabase");
  expect(successDialog.message).toBe(
    "Your account is ready. Close this dialog, ask me to list your Supabase projects, then ask me to connect one to MCP.",
  );
  expect((successDialog as Record<string, unknown>).onCancel).toBeUndefined();
  expect(api.__test.dialogAlerts).toHaveLength(1);
  expect(api.__test.dialogConfirms).toHaveLength(0);

  await successDialog.onConfirm?.();

  expect(api.__test.promptOps).toEqual([]);
  expect(api.__test.promptOps.some((op) => op.op === "submitPrompt")).toBe(false);
  expect(api.__test.cleared).toBe(1);
  expect(api.__test.toasts).toEqual([]);
  expect(states.at(-1)).toEqual({ type: "success" });
});

test("supabase auth success injects ignored onboarding into current session", async () => {
  const api = createDialogApi({
    route: {
      current: {
        name: "session",
        params: { sessionID: "session-current" },
      },
      navigate: () => undefined,
    },
  });
  const lifecycle = { closed: false };

  const dialog = SupabaseDialog({
    api: api as never,
    logger: createLogger(),
    onClose: () => api.ui.dialog.clear(),
    initialState: { type: "idle" },
    lifecycle,
  }) as { onConfirm?: () => Promise<void> };

  await dialog.onConfirm?.();
  await Promise.resolve();

  expect(api.__test.sessionOps).toContainEqual(expect.objectContaining({
    op: "prompt",
    payload: expect.objectContaining({
      sessionID: "session-current",
      noReply: true,
      parts: [
        expect.objectContaining({
          type: "text",
          ignored: true,
          text: expect.stringContaining("organizations and projects"),
        }),
      ],
    }),
  }));
  expect(api.__test.promptOps).toEqual([]);
});

test("supabase auth success creates a session from home before OAuth not after", async () => {
  const ops: string[] = [];
  const api = createDialogApi({
    client: {
      app: {
        log: (_input: unknown) => Promise.resolve(true),
      },
      tui: {
        clearPrompt: () => Promise.resolve({ data: true }),
        appendPrompt: (_input: unknown) => Promise.resolve({ data: true }),
        submitPrompt: () => Promise.resolve({ data: true }),
      },
      session: {
        create: (input?: unknown) => {
          ops.push("create");
          api.__test.sessionOps.push({ op: "create", payload: input });
          return Promise.resolve({ data: { id: "session-created" } });
        },
        prompt: (input: unknown) => {
          ops.push("prompt");
          api.__test.sessionOps.push({ op: "prompt", payload: input });
          return Promise.resolve({ data: true });
        },
      },
      provider: {
        oauth: {
          authorize: () => {
            ops.push("authorize");
            return Promise.resolve({ data: { url: "https://example.com/auth", instructions: "Test", method: "manual" } });
          },
          callback: () => {
            ops.push("callback");
            return Promise.resolve({ data: true });
          },
        },
      },
    },
  });
  const lifecycle = { closed: false };

  const dialog = SupabaseDialog({
    api: api as never,
    logger: createLogger(),
    onClose: () => api.ui.dialog.clear(),
    initialState: { type: "idle" },
    lifecycle,
  }) as { onConfirm?: () => Promise<void> };

  await dialog.onConfirm?.();
  await Promise.resolve();

  // Session must be created and navigated BEFORE OAuth authorize runs
  const createIdx = ops.indexOf("create");
  const authorizeIdx = ops.indexOf("authorize");
  expect(createIdx).toBeGreaterThan(-1);
  expect(authorizeIdx).toBeGreaterThan(-1);
  expect(createIdx).toBeLessThan(authorizeIdx);

  expect(api.__test.routeOps).toEqual([
    { op: "navigate", name: "session", params: { sessionID: "session-created" } },
  ]);

  expect(api.__test.sessionOps).toContainEqual(expect.objectContaining({
    op: "prompt",
    payload: expect.objectContaining({ sessionID: "session-created", noReply: true }),
  }));
});

test("supabase already-connected confirm injects onboarding once", async () => {
  const api = createDialogApi({
    route: {
      current: {
        name: "session",
        params: { sessionID: "session-current" },
      },
      navigate: () => undefined,
    },
  });
  const lifecycle = { closed: false };

  const firstDialog = SupabaseDialog({
    api: api as never,
    logger: createLogger(),
    onClose: () => api.ui.dialog.clear(),
    initialState: { type: "already_connected" },
    lifecycle,
  }) as { onConfirm?: () => Promise<void> };

  await firstDialog.onConfirm?.();
  lifecycle.closed = false;

  const secondDialog = SupabaseDialog({
    api: api as never,
    logger: createLogger(),
    onClose: () => api.ui.dialog.clear(),
    initialState: { type: "already_connected" },
    lifecycle,
  }) as { onConfirm?: () => Promise<void> };

  await secondDialog.onConfirm?.();

  expect(api.__test.sessionOps.filter((op) => op.op === "prompt")).toHaveLength(1);
});

test("supabase already-connected confirm dedupes onboarding across dialog lifecycles", async () => {
  const api = createDialogApi({
    route: {
      current: {
        name: "session",
        params: { sessionID: "session-current" },
      },
      navigate: () => undefined,
    },
  });

  const firstDialog = SupabaseDialog({
    api: api as never,
    logger: createLogger(),
    onClose: () => api.ui.dialog.clear(),
    initialState: { type: "already_connected" },
    lifecycle: { closed: false },
  }) as { onConfirm?: () => Promise<void> };

  await firstDialog.onConfirm?.();

  const secondDialog = SupabaseDialog({
    api: api as never,
    logger: createLogger(),
    onClose: () => api.ui.dialog.clear(),
    initialState: { type: "already_connected" },
    lifecycle: { closed: false },
  }) as { onConfirm?: () => Promise<void> };

  await secondDialog.onConfirm?.();

  expect(api.__test.sessionOps.filter((op) => op.op === "prompt")).toHaveLength(1);
});

test("supabase disconnect does not inject onboarding", async () => {
  const api = createDialogApi();

  const dialog = SupabaseDialog({
    api: api as never,
    logger: createLogger(),
    onClose: () => api.ui.dialog.clear(),
    initialState: { type: "already_connected" },
  }) as { onCancel?: () => Promise<void> };

  await dialog.onCancel?.();

  expect(api.__test.sessionOps).toEqual([]);
});

test("supabase already-connected confirm saves onboarding before navigating from home", async () => {
  let currentRouteName = "home";
  let promptCalls = 0;
  let promptResolved = false;

  const api = createDialogApi({
    route: {
      current: {
        get name() {
          return currentRouteName;
        },
      },
      navigate: (name: string, params?: unknown) => {
        api.__test.routeOps.push({ op: "navigate", name, params });
        setTimeout(() => {
          currentRouteName = name;
        }, 0);
      },
    },
    client: {
      session: {
        create: (input?: unknown) => {
          api.__test.sessionOps.push({ op: "create", payload: input });
          return Promise.resolve({ data: { id: "session-created" } });
        },
        prompt: async (input: unknown) => {
          promptCalls++;
          if (currentRouteName !== "home") {
            throw new Error("prompt rejected: route changed before onboarding was saved");
          }
          api.__test.sessionOps.push({ op: "prompt", payload: input });
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          promptResolved = true;
          return Promise.resolve({ data: true });
        },
        promptAsync: () => {
          throw new Error("onboarding should wait for prompt persistence");
        },
      },
    },
  });
  const lifecycle = { closed: false };

  const dialog = SupabaseDialog({
    api: api as never,
    logger: createLogger(),
    onClose: () => api.ui.dialog.clear(),
    initialState: { type: "already_connected" },
    lifecycle,
  }) as { onConfirm?: () => Promise<void> };

  await dialog.onConfirm?.();

  expect(promptCalls).toBeGreaterThan(0);
  expect(promptResolved).toBe(true);
  expect(api.__test.sessionOps).toEqual([
    { op: "create", payload: {} },
    {
      op: "prompt",
      payload: {
        sessionID: "session-created",
        noReply: true,
        parts: [
          {
            type: "text",
            ignored: true,
            text: "Supabase is connected.\n\nStart by listing your Supabase projects, then connect project-scoped MCP tools for database inspection, docs, advisors, and more in OpenCode.\n\nYou can also ask about:\n- organizations and projects\n- regions\n- creating a new project\n\nTry this:\nList my Supabase projects",
          },
        ],
      },
    },
  ]);
  expect(api.__test.routeOps).toEqual([
    { op: "navigate", name: "session", params: { sessionID: "session-created" } },
  ]);
});

test("supabase auth preflight reports already connected when saved auth is still valid", async () => {
  const states: Array<Record<string, unknown>> = [];
  const api = createDialogApi({
    client: {
      app: {
        log: (_input: unknown) => Promise.resolve(true),
      },
      tui: {
        clearPrompt: () => Promise.resolve({ data: true }),
        appendPrompt: (_input: unknown) => Promise.resolve({ data: true }),
        submitPrompt: () => Promise.resolve({ data: true }),
      },
      session: {
        promptAsync: () => Promise.resolve({ data: true }),
      },
      provider: {
        oauth: {
          authorize: ({ method }: { method?: number }) => {
            if (method === 1) {
              return Promise.resolve({
                data: {
                  url: "https://supabase.com/",
                  instructions: JSON.stringify({ status: "connected", checked: false }),
                  method: "code",
                },
              });
            }
            return Promise.resolve({ data: { url: "https://example.com/auth", instructions: "Test", method: "manual" } });
          },
          callback: () => Promise.resolve({ data: true }),
        },
      },
    },
  });

  await runAuthPreflight({
    api: api as never,
    logger: createLogger(),
    setState: (state) => {
      states.push(state as unknown as Record<string, unknown>);
    },
  });

  expect(states).toEqual([{ type: "checking_auth" }, { type: "already_connected" }]);
});

test("supabase auth preflight surfaces corrupt-store notice", async () => {
  const states: Array<Record<string, unknown>> = [];
  const notice = {
    type: "auth_store_reset",
    message: "Supabase auth was reset because the local auth store was corrupted. Reconnect to continue.",
    backupPath: "/tmp/project/.opencode/supabase-auth.corrupt-2026-05-11T10-20-30-000Z.json",
  };
  const api = createDialogApi({
    client: {
      app: { log: (_input: unknown) => Promise.resolve(true) },
      tui: {
        clearPrompt: () => Promise.resolve({ data: true }),
        appendPrompt: (_input: unknown) => Promise.resolve({ data: true }),
        submitPrompt: () => Promise.resolve({ data: true }),
      },
      session: { promptAsync: () => Promise.resolve({ data: true }) },
      provider: {
        oauth: {
          authorize: ({ method }: { method?: number }) => {
            if (method === 1) {
              return Promise.resolve({
                data: {
                  url: "https://supabase.com/",
                  instructions: JSON.stringify({ status: "disconnected", checked: false, notice }),
                  method: "code",
                },
              });
            }
            return Promise.resolve({ data: { url: "https://example.com/auth", instructions: "Test", method: "manual" } });
          },
          callback: () => Promise.resolve({ data: true }),
        },
      },
    },
  });

  await runAuthPreflight({
    api: api as never,
    logger: createLogger(),
    setState: (state) => {
      states.push(state as unknown as Record<string, unknown>);
    },
  });

  expect(states).toEqual([{ type: "checking_auth" }, { type: "notice", notice }]);
});

test("supabase dialog notice shows backup path and reconnect action", async () => {
  let authorizeCalls = 0;
  const api = createDialogApi({
    client: {
      app: { log: (_input: unknown) => Promise.resolve(true) },
      tui: {
        clearPrompt: () => Promise.resolve({ data: true }),
        appendPrompt: (_input: unknown) => Promise.resolve({ data: true }),
        submitPrompt: () => Promise.resolve({ data: true }),
      },
      session: {
        create: () => Promise.resolve({ data: { id: "ses-notice" } }),
        promptAsync: () => Promise.resolve({ data: true }),
      },
      provider: {
        oauth: {
          authorize: ({ method }: { method?: number }) => {
            authorizeCalls += 1;
            return Promise.resolve({
              data: {
                url: method === 1 ? "https://supabase.com/" : "https://example.com/auth",
                instructions: method === 1 ? JSON.stringify({ status: "disconnected", checked: false }) : "Test",
                method: "manual",
              },
            });
          },
          callback: () => Promise.resolve({ data: true }),
        },
      },
    },
  });
  const backupPath = "/tmp/project/.opencode/supabase-auth.corrupt-2026-05-11T10-20-30-000Z.json";

  const dialog = SupabaseDialog({
    api: api as never,
    logger: createLogger(),
    onClose: () => api.ui.dialog.clear(),
    initialState: {
      type: "notice",
      notice: {
        type: "auth_store_reset",
        message: "Supabase auth was reset because the local auth store was corrupted. Reconnect to continue.",
        backupPath,
      },
    },
  }) as { title?: string; message?: string; onConfirm?: () => Promise<void>; onCancel?: () => void };

  expect(dialog.title).toBe("Supabase auth reset");
  expect(dialog.message).toContain("local Supabase auth file was corrupted");
  expect(dialog.message).toContain(backupPath);

  await dialog.onConfirm?.();

  expect(authorizeCalls).toBe(1);
});

test("supabase auth preflight shows unknown state when refresh verification fails", async () => {
  const states: Array<Record<string, unknown>> = [];
  const api = createDialogApi({
    client: {
      app: {
        log: (_input: unknown) => Promise.resolve(true),
      },
      tui: {
        clearPrompt: () => Promise.resolve({ data: true }),
        appendPrompt: (_input: unknown) => Promise.resolve({ data: true }),
        submitPrompt: () => Promise.resolve({ data: true }),
      },
      session: {
        promptAsync: () => Promise.resolve({ data: true }),
      },
      provider: {
        oauth: {
          authorize: ({ method }: { method?: number }) => {
            if (method === 1) {
              return Promise.resolve({
                data: {
                  url: "https://supabase.com/",
                  instructions: JSON.stringify({ status: "refresh_required", checked: true }),
                  method: "auto",
                },
              });
            }
            return Promise.resolve({ data: { url: "https://example.com/auth", instructions: "Test", method: "manual" } });
          },
          callback: ({ method }: { method?: number }) => {
            if (method === 1) {
              return Promise.resolve({
                error: {
                  data: {
                    name: "UnknownError",
                    data: {
                      message: "Supabase auth refresh failed: broker unavailable",
                    },
                  },
                  errors: [],
                  success: false,
                },
              });
            }
            return Promise.resolve({ data: true });
          },
        },
      },
    },
  });

  await runAuthPreflight({
    api: api as never,
    logger: createLogger(),
    setState: (state) => {
      states.push(state as unknown as Record<string, unknown>);
    },
  });

  expect(states).toEqual([
    { type: "checking_auth" },
    {
      type: "unknown",
      message: "Supabase auth refresh failed: broker unavailable",
    },
  ]);
});

test("supabase auth preflight surfaces notice after refresh callback error", async () => {
  const states: Array<Record<string, unknown>> = [];
  const notice = {
    type: "auth_store_reset",
    message: "Supabase auth was reset because the local auth store was corrupted. Reconnect to continue.",
    backupPath: "/tmp/project/.opencode/supabase-auth.corrupt-2026-05-11T10-20-30-000Z.json",
  };
  let authorizeCalls = 0;
  const api = createDialogApi({
    client: {
      app: {
        log: (_input: unknown) => Promise.resolve(true),
      },
      tui: {
        clearPrompt: () => Promise.resolve({ data: true }),
        appendPrompt: (_input: unknown) => Promise.resolve({ data: true }),
        submitPrompt: () => Promise.resolve({ data: true }),
      },
      session: {
        promptAsync: () => Promise.resolve({ data: true }),
      },
      provider: {
        oauth: {
          authorize: ({ method }: { method?: number }) => {
            authorizeCalls += 1;
            if (method === 1) {
              if (authorizeCalls === 1) {
                return Promise.resolve({
                  data: {
                    url: "https://supabase.com/",
                    instructions: JSON.stringify({ status: "refresh_required", checked: true }),
                    method: "auto",
                  },
                });
              }
              return Promise.resolve({
                data: {
                  url: "https://supabase.com/",
                  instructions: JSON.stringify({ status: "disconnected", checked: false, notice }),
                  method: "auto",
                },
              });
            }
            return Promise.resolve({ data: { url: "https://example.com/auth", instructions: "Test", method: "manual" } });
          },
          callback: ({ method }: { method?: number }) => {
            if (method === 1) {
              return Promise.resolve({
                error: {
                  data: {
                    name: "UnknownError",
                    data: {
                      message: "Supabase auth refresh failed: broker unavailable",
                    },
                  },
                  errors: [],
                  success: false,
                },
              });
            }
            return Promise.resolve({ data: true });
          },
        },
      },
    },
  });

  await runAuthPreflight({
    api: api as never,
    logger: createLogger(),
    setState: (state) => {
      states.push(state as unknown as Record<string, unknown>);
    },
  });

  expect(states).toEqual([
    { type: "checking_auth" },
    { type: "notice", notice },
  ]);
});

test("supabase auth preflight surfaces notice after refresh callback false", async () => {
  const states: Array<Record<string, unknown>> = [];
  const notice = {
    type: "auth_store_reset",
    message: "Supabase auth was reset because the local auth store was corrupted. Reconnect to continue.",
    backupPath: "/tmp/project/.opencode/supabase-auth.corrupt-2026-05-11T10-20-30-000Z.json",
  };
  let authorizeCalls = 0;
  const api = createDialogApi({
    client: {
      app: {
        log: (_input: unknown) => Promise.resolve(true),
      },
      tui: {
        clearPrompt: () => Promise.resolve({ data: true }),
        appendPrompt: (_input: unknown) => Promise.resolve({ data: true }),
        submitPrompt: () => Promise.resolve({ data: true }),
      },
      session: {
        promptAsync: () => Promise.resolve({ data: true }),
      },
      provider: {
        oauth: {
          authorize: ({ method }: { method?: number }) => {
            authorizeCalls += 1;
            if (method === 1) {
              if (authorizeCalls === 1) {
                return Promise.resolve({
                  data: {
                    url: "https://supabase.com/",
                    instructions: JSON.stringify({ status: "refresh_required", checked: true }),
                    method: "auto",
                  },
                });
              }
              return Promise.resolve({
                data: {
                  url: "https://supabase.com/",
                  instructions: JSON.stringify({ status: "disconnected", checked: false, notice }),
                  method: "auto",
                },
              });
            }
            return Promise.resolve({ data: { url: "https://example.com/auth", instructions: "Test", method: "manual" } });
          },
          callback: ({ method }: { method?: number }) => {
            if (method === 1) {
              return Promise.resolve({ data: false });
            }
            return Promise.resolve({ data: true });
          },
        },
      },
    },
  });

  await runAuthPreflight({
    api: api as never,
    logger: createLogger(),
    setState: (state) => {
      states.push(state as unknown as Record<string, unknown>);
    },
  });

  expect(states).toEqual([
    { type: "checking_auth" },
    { type: "notice", notice },
  ]);
});

test("supabase dialog already connected offers disconnect action", async () => {
  const authorizeCalls: Array<{ providerID?: string; method?: number; inputs?: Record<string, string> }> = [];
  const api = createDialogApi({
    client: {
      app: {
        log: (_input: unknown) => Promise.resolve(true),
      },
      tui: {
        clearPrompt: () => Promise.resolve({ data: true }),
        appendPrompt: (_input: unknown) => Promise.resolve({ data: true }),
        submitPrompt: () => Promise.resolve({ data: true }),
      },
      session: {
        promptAsync: () => Promise.resolve({ data: true }),
      },
      provider: {
        oauth: {
          authorize: (input: { method?: number; inputs?: Record<string, string> }) => {
            authorizeCalls.push(input);
            return Promise.resolve({
              data: {
                url: "https://supabase.com/",
                instructions: JSON.stringify({ status: "disconnected", checked: false }),
                method: "code",
              },
            });
          },
          callback: () => Promise.resolve({ data: true }),
        },
      },
    },
  });

  const dialog = SupabaseDialog({
    api: api as never,
    logger: createLogger(),
    onClose: () => api.ui.dialog.clear(),
    initialState: { type: "already_connected" },
  }) as { title?: string; message?: string; onCancel?: () => Promise<void> };

  expect(dialog.title).toBe("You're all set");
  expect(dialog.message).toBe(
    "Your Supabase account is connected and ready to go.\n\nClose this dialog to continue, or disconnect to sign out.",
  );
  await dialog.onCancel?.();

  expect(authorizeCalls).toEqual([{ providerID: "supabase", method: 1, inputs: { action: "disconnect" } }]);
  expect(api.__test.cleared).toBe(1);
  expect(api.__test.toasts).toEqual([{ message: "Disconnected from Supabase" }]);
});

test("supabase dialog starts preflight only once while first check is pending", async () => {
  let authorizeCalls = 0;
  let currentDialog: unknown;

  const api = createDialogApi({
    ui: {
      Dialog: (input: unknown) => input,
      DialogAlert: (input: unknown) => input,
      DialogConfirm: (input: unknown) => input,
      toast: (_input: { variant?: string; message: string }) => undefined,
        dialog: {
          replace: (factory: () => unknown) => {
            currentDialog = factory();
          },
          clear: () => undefined,
          setSize: () => undefined,
        },
    },
    client: {
      app: {
        log: (_input: unknown) => Promise.resolve(true),
      },
      tui: {
        clearPrompt: () => Promise.resolve({ data: true }),
        appendPrompt: (_input: unknown) => Promise.resolve({ data: true }),
        submitPrompt: () => Promise.resolve({ data: true }),
      },
      session: {
        promptAsync: () => Promise.resolve({ data: true }),
      },
      provider: {
        oauth: {
          authorize: ({ method }: { method?: number }) => {
            if (method === 1) {
              authorizeCalls += 1;
              if (authorizeCalls > 1) {
                return Promise.reject(new Error("duplicate preflight"));
              }
              return Promise.resolve({
                data: {
                  url: "https://supabase.com/",
                  instructions: JSON.stringify({ status: "connected", checked: false }),
                  method: "code",
                },
              });
            }
            return Promise.resolve({ data: { url: "https://example.com/auth", instructions: "Test", method: "manual" } });
          },
          callback: () => Promise.resolve({ data: true }),
        },
      },
    },
  });

  currentDialog = SupabaseDialog({
    api: api as never,
    logger: createLogger(),
    onClose: () => undefined,
  });

  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  expect(currentDialog).toMatchObject({
    title: "You're all set",
  });
  expect(authorizeCalls).toBe(1);
});

test("tui plugin reusing the original /supabase dialog factory should not start duplicate preflight work", async () => {
  let commandsFactory: (() => Array<Record<string, unknown>>) | undefined;
  let replaceFactory: (() => unknown) | undefined;
  let authorizeCalls = 0;
  let resolveFirstAuthorize: (() => void) | undefined;

  await tuiModule.tui(
    {
      command: {
        register: (factory: () => Array<Record<string, unknown>>) => {
          commandsFactory = factory;
          return () => {};
        },
      },
      ui: {
        Dialog: (input: unknown) => input,
        DialogAlert: (input: unknown) => input,
        DialogConfirm: (input: unknown) => input,
        dialog: {
          replace: (factory: () => unknown) => {
            replaceFactory = factory;
          },
          clear: () => {},
          setSize: () => {},
        },
        toast: () => {},
      },
      client: {
        provider: {
          oauth: {
            authorize: ({ method }: { method?: number }) => {
              if (method === 1) {
                authorizeCalls += 1;
                if (authorizeCalls === 1) {
                  return new Promise((resolve) => {
                    resolveFirstAuthorize = () =>
                      resolve({
                        data: {
                          url: "https://supabase.com/",
                          instructions: JSON.stringify({ status: "connected", checked: false }),
                          method: "code",
                        },
                      });
                  });
                }

                return Promise.resolve({
                  data: {
                    url: "https://supabase.com/",
                    instructions: JSON.stringify({ status: "connected", checked: false }),
                    method: "code",
                  },
                });
              }

              return Promise.resolve({
                data: {
                  url: "https://example.com/auth",
                  instructions: "Test",
                  method: "manual",
                },
              });
            },
            callback: () => Promise.resolve({ data: true }),
          },
        },
      },
    } as never,
    undefined,
    {} as never,
  );

  const command = commandsFactory?.()[0] as { onSelect?: () => void } | undefined;
  command?.onSelect?.();

  expect(typeof replaceFactory).toBe("function");
  replaceFactory?.();
  replaceFactory?.();

  await Promise.resolve();
  await Promise.resolve();

  expect(authorizeCalls).toBe(1);

  resolveFirstAuthorize?.();
  await Promise.resolve();
  await Promise.resolve();

  expect(authorizeCalls).toBe(1);
});

test("supabase dialog keeps disconnect failure visible", async () => {
  let currentDialog: unknown;
  const api = createDialogApi({
    ui: {
      Dialog: (input: unknown) => input,
      DialogAlert: (input: unknown) => input,
      DialogConfirm: (input: unknown) => input,
      toast: (_input: { variant?: string; message: string }) => undefined,
      dialog: {
        replace: (factory: () => unknown) => {
          currentDialog = factory();
        },
        clear: () => undefined,
      },
    },
    client: {
      app: {
        log: (_input: unknown) => Promise.resolve(true),
      },
      tui: {
        clearPrompt: () => Promise.resolve({ data: true }),
        appendPrompt: (_input: unknown) => Promise.resolve({ data: true }),
        submitPrompt: () => Promise.resolve({ data: true }),
      },
      session: {
        promptAsync: () => Promise.resolve({ data: true }),
      },
      provider: {
        oauth: {
          authorize: () => Promise.reject(new Error("disconnect unavailable")),
          callback: () => Promise.resolve({ data: true }),
        },
      },
    },
  });

  const dialog = SupabaseDialog({
    api: api as never,
    logger: createLogger(),
    onClose: () => api.ui.dialog.clear(),
    initialState: { type: "already_connected" },
  }) as { onCancel?: () => Promise<void> };
  currentDialog = dialog;

  await dialog.onCancel?.();

  expect(api.__test.cleared).toBe(0);
  expect(currentDialog).toMatchObject({
    title: "Supabase connection status unknown",
  });
});

test("supabase dialog unknown state offers retry and continue", async () => {
  const api = createDialogApi();
  const dialog = SupabaseDialog({
    api: api as never,
    logger: createLogger(),
    onClose: () => api.ui.dialog.clear(),
    initialState: {
      type: "unknown",
      message: "Saved Supabase login found, but couldn't verify it right now.",
    },
  }) as { title?: string; onConfirm?: () => Promise<void>; onCancel?: () => void };

  expect(dialog.title).toBe("Supabase connection status unknown");
  expect(typeof dialog.onConfirm).toBe("function");
  expect(typeof dialog.onCancel).toBe("function");
});

test("supabase dialog starts with custom checking spinner dialog", () => {
  const api = createDialogApi();
  const dialog = SupabaseDialog({
    api: api as never,
    logger: createLogger(),
    onClose: () => api.ui.dialog.clear(),
  });

  expect(typeof dialog).toBe("function");
  expect(api.__test.dialogAlerts).toHaveLength(0);
  expect(api.__test.dialogs).toHaveLength(0);
  expect(api.__test.setSizes).toEqual(["medium"]);
});

test("supabase dialog idle uses built in confirm dialog", () => {
  const api = createDialogApi();
  const dialog = SupabaseDialog({
    api: api as never,
    logger: createLogger(),
    onClose: () => api.ui.dialog.clear(),
    initialState: { type: "idle" },
  });

  expect(dialog).toMatchObject({
    title: "Connect your Supabase account",
    message: "Open your browser to authorize OpenCode to access your Supabase account.",
  });
  expect(api.__test.dialogConfirms).toHaveLength(1);
  expect(api.__test.dialogs).toHaveLength(0);
});

test("supabase dialog waiting states use custom spinner dialog", () => {
  const api = createDialogApi();
  const waiting = SupabaseDialog({
    api: api as never,
    logger: createLogger(),
    onClose: () => api.ui.dialog.clear(),
    initialState: { type: "waiting_callback", url: "https://example.com/auth" },
  });

  expect(typeof waiting).toBe("function");
  expect(api.__test.dialogAlerts).toHaveLength(0);
  expect(api.__test.dialogs).toHaveLength(0);
  expect(api.__test.setSizes).toEqual(["large"]);
});

test("supabase auth flow enters waiting state before callback resolves", async () => {
  const states: Array<Record<string, unknown>> = [];
  let releaseCallback!: () => void;

  const api = createDialogApi({
    client: {
      app: {
        log: (_input: unknown) => Promise.resolve(true),
      },
      tui: {
        clearPrompt: () => Promise.resolve({ data: true }),
        appendPrompt: (_input: unknown) => Promise.resolve({ data: true }),
        submitPrompt: () => Promise.resolve({ data: true }),
      },
      session: {
        promptAsync: () => Promise.resolve({ data: true }),
      },
      provider: {
        oauth: {
          authorize: () => Promise.resolve({ data: { url: "https://example.com/auth", instructions: "Test", method: "manual" } }),
          callback: () =>
            new Promise((resolve) => {
              releaseCallback = () => resolve({ data: true });
            }),
        },
      },
    },
  });

  const authPromise = runAuthFlow({
    api: api as never,
    logger: createLogger(),
    onSuccess: () => {},
    setState: (state) => {
      states.push(state as unknown as Record<string, unknown>);
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(states).toContainEqual({ type: "waiting_callback", url: "https://example.com/auth" });

  releaseCallback();
  await authPromise;
});

test("supabase dialog error uses simple built in retry dialog", () => {
  const api = createDialogApi();
  const dialog = SupabaseDialog({
    api: api as never,
    logger: createLogger(),
    onClose: () => api.ui.dialog.clear(),
    initialState: { type: "error", message: "bad auth", url: "https://example.com/auth" },
  });

  expect(dialog).toMatchObject({
    title: "Authorization Failed",
  });
  expect(api.__test.dialogConfirms).toHaveLength(1);
  expect(api.__test.dialogs).toHaveLength(0);
});

test("error retry starts fresh oauth without using stale url", async () => {
  let authorizeCalls = 0;
  let callbackCalls = 0;

  const api = createDialogApi({
    client: {
      app: {
        log: (_input: unknown) => Promise.resolve(true),
      },
      tui: {
        clearPrompt: () => Promise.resolve({ data: true }),
        appendPrompt: (_input: unknown) => Promise.resolve({ data: true }),
        submitPrompt: () => Promise.resolve({ data: true }),
      },
      session: {
        create: () => Promise.resolve({ data: { id: "ses-retry" } }),
        promptAsync: () => Promise.resolve({ data: true }),
      },
      provider: {
        oauth: {
          authorize: () => {
            authorizeCalls += 1;
            return Promise.resolve({
              data: {
                url: "https://example.com/fresh",
                instructions: "Test",
                method: "manual",
              },
            });
          },
          callback: () => {
            callbackCalls += 1;
            return Promise.resolve({ data: true });
          },
        },
      },
    },
  });

  const dialog = SupabaseDialog({
    api: api as never,
    logger: createLogger(),
    onClose: () => api.ui.dialog.clear(),
    initialState: {
      type: "error",
      message: "bad auth",
      url: "https://example.com/stale",
    },
  }) as { onConfirm?: () => Promise<void> };

  await dialog.onConfirm?.();

  expect(authorizeCalls).toBe(1);
  expect(callbackCalls).toBe(1);
});

test("supabase dialog error preserves url for retry messaging", async () => {
  const states: Array<Record<string, unknown>> = [];
  const api = createDialogApi({
    client: {
      app: {
        log: (_input: unknown) => Promise.resolve(true),
      },
      tui: {
        clearPrompt: () => Promise.resolve({ data: true }),
        appendPrompt: (_input: unknown) => Promise.resolve({ data: true }),
        submitPrompt: () => Promise.resolve({ data: true }),
      },
      session: {
        promptAsync: () => Promise.resolve({ data: true }),
      },
      provider: {
        oauth: {
          authorize: () => Promise.resolve({ data: { url: "https://example.com/auth", instructions: "Test", method: "manual" } }),
          callback: () => Promise.resolve({
            error: {
              data: {
                name: "UnknownError",
                data: {
                  message: "broker returned an invalid response",
                },
              },
              errors: [],
              success: false,
            },
          }),
        },
      },
    },
  });

  await runAuthFlow({
    api: api as never,
    logger: createLogger(),
    onSuccess: () => {},
    setState: (state) => {
      states.push(state as unknown as Record<string, unknown>);
    },
  });

  expect(states.at(-1)).toEqual({
    type: "error",
    message: "broker returned an invalid response",
    url: "https://example.com/auth",
  });
});

test("auth success html includes a small prompt snippet", () => {
  expect(HTML_SUCCESS).toContain("Authorization Successful");
  expect(HTML_SUCCESS).toContain("You can <strong>close this window</strong> and return to OpenCode.");
  expect(HTML_SUCCESS).toContain("Try this next:");
  expect(HTML_SUCCESS).toContain("list my Supabase projects");
  expect(HTML_SUCCESS).toContain("Then try:");
  expect(HTML_SUCCESS).toContain("connect a project to MCP");
});

test("supabase dialog logs auth milestones without leaking oauth query values", async () => {
  const logs: LogEntry[] = [];
  const api = createDialogApi({
    client: {
      app: {
        log: (_input: unknown) => Promise.resolve(true),
      },
      tui: {
        clearPrompt: () => Promise.resolve({ data: true }),
        appendPrompt: (_input: unknown) => Promise.resolve({ data: true }),
        submitPrompt: () => Promise.resolve({ data: true }),
      },
      session: {
        promptAsync: () => Promise.resolve({ data: true }),
      },
      provider: {
        oauth: {
          authorize: () => Promise.resolve({ data: { url: "https://example.com/auth?code=secret", instructions: "Test", method: "auto" } }),
          callback: () => Promise.resolve({ data: true }),
        },
      },
    },
  });

  await runAuthFlow({
    api: api as never,
    logger: createLogger(logs),
    onSuccess: () => {},
    setState: () => {},
  });

  const serialized = JSON.stringify(logs);
  expect(serialized).toContain("supabase auth started");
  expect(serialized).toContain("supabase auth completed");
  expect(serialized).not.toContain("code=secret");
});
