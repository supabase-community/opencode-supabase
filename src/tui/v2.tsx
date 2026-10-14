import type { Context } from "@opencode/plugin/tui/plugin";
import { TextAttributes } from "@opentui/core";
import open from "open";
import { createSignal, onCleanup } from "solid-js";
import { ONBOARDING_MESSAGE } from "./dialog.tsx";

const onboarding = new WeakMap<Context, Set<string>>();
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

function PendingDialog(props: { ctx: Context; url: string; onDismiss: () => void }) {
  const [frame, setFrame] = createSignal(0);
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  const timer = setInterval(() => setFrame((f) => (f + 1) % frames.length), 80).unref();
  onCleanup(() => clearInterval(timer));
  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <text fg={props.ctx.theme.text} attributes={TextAttributes.BOLD}>Connect to Supabase</text>
      <text fg={props.ctx.theme.textMuted}>{frames[frame()]} Waiting for browser authorization...</text>
      <text fg={props.ctx.theme.text}>Complete authorization in your browser.</text>
      <text fg={props.ctx.theme.textMuted}>If the browser did not open, visit:</text>
      <text fg={props.ctx.theme.text}>{props.url}</text>
      <text fg={props.ctx.theme.textMuted}>You can dismiss this dialog; browser approval completes authorization.</text>
      <box alignSelf="flex-end" onMouseUp={props.onDismiss}>
        <text fg={props.ctx.theme.primary}>Dismiss</text>
      </box>
    </box>
  );
}

async function onboard(ctx: Context, directory: string) {
  const route = ctx.ui.router.current();
  if (route.type !== "home" && route.type !== "session") return;
  const sessionID = route.type === "session" ? route.sessionID
    : (await ctx.client.session.create({ location: { directory } })).id;
  const done = onboarding.get(ctx) ?? new Set<string>();
  onboarding.set(ctx, done);
  if (!done.has(sessionID)) {
    await ctx.client.session.prompt({ sessionID, text: ONBOARDING_MESSAGE, resume: false });
    done.add(sessionID);
  }
  if (route.type === "home") ctx.ui.router.navigate({ type: "session", sessionID });
}

export function setupV2Tui(ctx: Context, openBrowser: (url: string) => Promise<unknown> = open) {
  let disposed = false;
  let running = false;
  const attempts = new Set<{ integrationID: string; attemptID: string; location: { directory: string } }>();

  const connect = async (directory: string) => {
    const confirmed = await ctx.ui.dialog.confirm({
      title: "Connect your Supabase account",
      message: "Open your browser to authorize OpenCode to access your Supabase account.",
    });
    if (!confirmed || disposed) return;
    const { data: attempt } = await ctx.client.integration.oauth.connect({
      integrationID: "supabase", methodID: "supabase", location: { directory },
    });
    const input = { integrationID: "supabase", attemptID: attempt.attemptID, location: { directory } };
    attempts.add(input);
    let dismissed = false;
    let completed = false;
    try {
      if (disposed) return;
      ctx.ui.dialog.show(() => PendingDialog({ ctx, url: attempt.url, onDismiss: () => ctx.ui.dialog.clear() }),
        () => { dismissed = true; });
      ctx.ui.dialog.set({ size: "large" });
      // Browser failure leaves a visible manual URL rather than aborting OAuth.
      await openBrowser(attempt.url).catch(() => ctx.ui.toast.show({
        variant: "warning", message: "Could not open your browser. Use the authorization URL in the dialog.",
      }));
      while (!disposed && Date.now() < attempt.time.expires) {
        const { data: status } = await ctx.client.integration.oauth.status(input);
        if (status.status === "complete") { completed = true; break; }
        if (status.status === "failed") throw new Error(status.message);
        if (status.status === "expired") throw new Error("Supabase authorization expired. Run /supabase to retry.");
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      if (disposed) return;
      if (!completed) throw new Error("Supabase authorization expired. Run /supabase to retry.");
      if (dismissed) {
        ctx.ui.toast.show({ message: "Supabase connected", variant: "success" });
        return;
      }
      ctx.ui.dialog.clear();
      await onboard(ctx, directory);
      await ctx.ui.dialog.alert({ title: "Connected to Supabase", message: "Your account is ready. Ask me to list your Supabase projects, then connect one to MCP." });
    } catch (error) {
      if (!dismissed && !disposed) ctx.ui.dialog.clear();
      throw error;
    } finally {
      if (!completed) await ctx.client.integration.oauth.cancel(input);
      attempts.delete(input);
    }
  };

  const run = async () => {
    if (running || disposed) return;
    running = true;
    try {
      const { directory } = ctx.location ?? ctx.data.location.default();
      const { data: integration } = await ctx.client.integration.get({ integrationID: "supabase", location: { directory } });
      const accounts = integration.connections.filter((c) => c.type === "credential");
      // OpenCode orders the active credential first, including after native /connect changes.
      const account = accounts[0];
      if (!account) { await connect(directory); return; }
      const action = await ctx.ui.dialog.select({
        title: "Supabase account",
        options: [
          { title: "Continue with current account", value: "continue" },
          { title: "Disconnect current account", value: "disconnect" },
        ],
      });
      if (disposed) return;
      if (action === "continue") await onboard(ctx, directory);
      if (action === "disconnect") {
        const confirmed = await ctx.ui.dialog.confirm({
          title: "Disconnect current Supabase account?",
          message: `Remove ${account.label} from OpenCode? This does not revoke access at Supabase.${accounts.length > 1 ? " Another saved account will become active." : ""}`,
        });
        if (!confirmed || disposed) return;
        await ctx.client.credential.remove({ credentialID: account.id });
        ctx.ui.toast.show({ message: "Current Supabase account disconnected" });
      }
    } catch (error) {
      if (!disposed) ctx.ui.toast.show({ title: "Supabase action failed", message: message(error), variant: "error" });
    } finally { running = false; }
  };
  ctx.keymap.layer(() => ({ mode: "global", commands: [{
    id: "supabase.connect", title: "Connect to Supabase", group: "Supabase",
    slash: { name: "supabase" }, palette: true, run,
  }] }));
  return async () => {
    disposed = true;
    await Promise.all([...attempts].map((input) => ctx.client.integration.oauth.cancel(input)));
  };
}
