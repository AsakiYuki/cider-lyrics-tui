# Cider Lyrics TUI

A terminal lyrics display synchronized with the track playing in Cider. It reads Apple TTML lyrics from Cider and renders timed lyrics in a live terminal interface.

> **Requirement:** This tool is made for the **Cider 2 desktop app by Cider Collective**. Install Cider from [cider.sh](https://cider.sh), keep it running, and play a track there. This CLI connects to Cider's local API; it does not connect directly to Apple Music.

## Features

- Reads TTML from Cider and uses its timing instead of the separate word-timing field.
- Highlights lyrics progressively from left to right, down to individual characters when timing is available.
- Uses line timing as a fallback when word or span timing is unavailable.
- Displays background vocals underneath the corresponding lead line and honors their timing.
- Follows playback and track changes in real time.
- Supports a playback display offset and exporting the current lyrics as Apple TTML.

## Requirements

- [Cider 2](https://cider.sh/) by Cider Collective, running with a track playing.
- [Bun](https://bun.sh/) installed.
- A terminal that supports ANSI colors and alternate-screen mode for the full-screen TUI.

## Install

Clone the repository and install dependencies:

```sh
git clone https://github.com/AsakiYuki/cider-lyrics-tui.git
cd cider-lyrics-tui
bun install
```

## Authorize with Cider

Request a Cider API token with the `lyrics` and `playback` scopes:

```sh
bun run start --auth
```

Approve the request in Cider. The token is saved to `~/.config/cider-lyrics/token` with user-only file permissions. If you have an older token without the `playback` scope, run the authorization command again.

Alternatively, provide a token through the environment:

```sh
CIDER_API_TOKEN=your-token bun run start
```

## Usage

Start the live lyrics display for the currently playing track:

```sh
bun run start
```

Press `Ctrl+C` to exit.

Adjust lyric synchronization with an offset in seconds. A positive value makes the displayed lyrics advance earlier; a negative value delays them:

```sh
bun run start --offset 0.25
bun run start --offset=-0.15
```

You can also set a default offset with `CIDER_LYRICS_OFFSET`:

```sh
CIDER_LYRICS_OFFSET=0.25 bun run start
```

Export the current track's Apple TTML to standard output or a file:

```sh
bun run start --ttml
bun run start --ttml lyrics.ttml
```

## Configuration

| Variable              | Description                                           | Default                  |
| --------------------- | ----------------------------------------------------- | ------------------------ |
| `CIDER_API_TOKEN`     | Use an existing API token instead of the saved token. | —                        |
| `CIDER_URL`           | Cider API base URL.                                   | `http://127.0.0.1:10767` |
| `CIDER_LYRICS_OFFSET` | Display synchronization offset, in seconds.           | `0`                      |

The Cider API URL can also be changed for a single invocation:

```sh
CIDER_URL=http://127.0.0.1:10767 bun run start
```

## How timing works

The TUI refreshes on a local playback clock between periodic playback-time syncs, so lyric animation stays smooth without polling Cider on every frame. TTML timed spans drive the character-by-character fade. If Cider provides no usable timed spans, the CLI falls back to line-level timing.
