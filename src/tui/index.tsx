import type { TuiPlugin } from "@opencode-ai/plugin/tui";

import { createSupabaseLogger, createTuiLogWriter } from "../shared/log.ts";
import { createSupabaseCommand } from "./commands.ts";
import { SupabaseDialog } from "./dialog.tsx";
import { setupV2Tui } from "./v2.tsx";

const tui: TuiPlugin = async (api) => {
  const logger = createSupabaseLogger({
    write: createTuiLogWriter(api.client),
  });

  api.command.register(() => [
    createSupabaseCommand(() => {
      const lifecycle = { closed: false };
      api.ui.dialog.replace(() =>
        SupabaseDialog({
          api,
          logger,
          lifecycle,
          onClose: () => api.ui.dialog.clear(),
        }),
      );
    }),
  ]);
};

export default { id: "supabase", tui, setup: setupV2Tui };
