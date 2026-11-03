#!/usr/bin/env bun
import { render, type Instance } from "ink";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { buildAuthorizeUrl, createPkcePair, exchangeCode, parseCallbackUrl, tokenProvider } from "./auth";
import { runCommand, USAGE } from "./commands";
import { Review } from "./review/Review";
import { createSpotifyClient } from "./spotify";
import { readToken, stateDir, writeToken } from "./store";
import type { DuplicateGroup } from "./types";
import { Progress } from "./ui/Progress";

const DEFAULT_REDIRECT_URI = "http://127.0.0.1:8888/callback";

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

async function login(dir: string, clientId: string, redirectUri: string): Promise<void> {
  if (readToken(dir)) return;
  const { verifier, challenge } = createPkcePair();
  const state = randomUUID();
  console.log("open this URL in a browser on any device and approve:\n");
  console.log(buildAuthorizeUrl({ clientId, redirectUri, challenge, state }));
  console.log(`\nthe browser then lands on ${redirectUri}?code=... and shows an error page. that's expected.`);
  const pasted = await prompt("paste the full URL from the address bar: ");
  const code = parseCallbackUrl(pasted, state);
  writeToken(dir, await exchangeCode({ clientId, redirectUri, code, verifier }));
  console.log("logged in.");
}

function reviewInTerminal(groups: DuplicateGroup[]): Promise<string[] | null> {
  return new Promise((resolve) => {
    const app = render(
      <Review
        groups={groups}
        onApprove={(uris) => {
          app.unmount();
          resolve(uris);
        }}
        onQuit={() => {
          app.unmount();
          resolve(null);
        }}
      />,
    );
  });
}

function progressReporter() {
  let bar: Instance | null = null;
  return (label: string, done: number, total: number) => {
    const node = <Progress label={label} done={done} total={total} />;
    if (bar) bar.rerender(node);
    else bar = render(node);
    if (done >= total) {
      bar.unmount();
      bar = null;
    }
  };
}

async function main(): Promise<number> {
  const cmd = process.argv[2];
  if (!cmd || cmd === "help" || cmd === "--help") {
    console.log(USAGE);
    return cmd ? 0 : 1;
  }
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  if (!clientId) {
    console.error("error: SPOTIFY_CLIENT_ID is not set. see README for creating a Spotify app.");
    return 1;
  }
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI ?? DEFAULT_REDIRECT_URI;
  const dir = stateDir();
  const tokens = tokenProvider({ dir, clientId });
  return runCommand(cmd, {
    dir,
    client: createSpotifyClient(tokens),
    now: () => new Date(),
    ensureLogin: () => login(dir, clientId, redirectUri),
    review: reviewInTerminal,
    progress: progressReporter(),
    log: (line) => console.log(line),
  });
}

process.exit(await main());
