import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_URL = "https://github.com/supabase-community/opencode-supabase";

const LOGO_SVG = readFileSync(join(__dirname, "assets", "supabase-logo-wordmark--dark.svg"), "utf-8");

const LOGO_DATA_URI = `data:image/svg+xml;base64,${Buffer.from(LOGO_SVG).toString("base64")}`;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const SHARED_STYLES = `
  *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
    background: #1C1C1C;
    color: #EDEDED;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }
  .logo {
    position: absolute;
    top: 24px;
    left: 24px;
    width: 140px;
    height: auto;
  }
  .container {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 32px;
    padding: 48px 40px;
    background: #242424;
    border-radius: 16px;
    border: 1px solid #2e2e2e;
    max-width: 400px;
    width: 90%;
  }
  .heading-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .icon {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    font-weight: 600;
    line-height: 1;
    flex-shrink: 0;
  }
  .icon-success { background: #3ECF8E; color: #fff; }
  .icon-error { background: #ef4444; color: #fff; }
  h1 { font-size: 20px; font-weight: 600; letter-spacing: -0.01em; text-align: center; }
  p { font-size: 16px; color: #EDEDED; text-align: center; line-height: 1.5; max-width: 280px; }
  .prompt-label { font-size: 13px; color: #8b8b8b; text-align: center; }
  .prompt-box {
    width: 100%;
    background: #1b1b1b;
    border: 1px solid #2e2e2e;
    border-radius: 10px;
    padding: 12px 14px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 13px;
    color: #EDEDED;
    text-align: center;
  }
  .footer { margin-top: 8px; line-height: 1.5; text-align: center; color: #666; font-size: 12px; }
  .footer a { color: #8b8b8b; text-decoration: underline; text-underline-offset: 2px; }
  .footer a:hover { color: #EDEDED; }
`;

export const HTML_SUCCESS = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>OpenCode - Supabase Authorization Successful</title>
    <style>${SHARED_STYLES}</style>
  </head>
  <body>
    <img class="logo" src="${LOGO_DATA_URI}" alt="Supabase">
    <div class="container">
      <div class="heading-row">
        <div class="icon icon-success">&#10003;</div>
        <h1>Authorization Successful</h1>
      </div>
      <p>You can <strong>close this window</strong> and return to OpenCode.</p>
      <div class="prompt-label">Try this next:</div>
      <div class="prompt-box">list my Supabase projects</div>
      <div class="prompt-label">Then try:</div>
      <div class="prompt-box">connect a project to MCP</div>
      <div class="footer">Having troubles or found a bug?<br><a href="${REPO_URL}" target="_blank" rel="noopener">Report it on GitHub</a></div>
    </div>
    <script>setTimeout(function(){window.close()},2000)</script>
  </body>
</html>`;

export function htmlError(message: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>OpenCode - Supabase Authorization Failed</title>
    <style>${SHARED_STYLES}</style>
  </head>
  <body>
    <img class="logo" src="${LOGO_DATA_URI}" alt="Supabase">
    <div class="container">
      <div class="heading-row">
        <div class="icon icon-error">&#10005;</div>
        <h1>Authorization Failed</h1>
      </div>
      <p>${escapeHtml(message)}</p>
      <div class="footer">Having troubles or found a bug?<br><a href="${REPO_URL}" target="_blank" rel="noopener">Report it on GitHub</a></div>
    </div>
  </body>
</html>`;
}
