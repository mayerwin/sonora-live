# Security policy

Sonora Live carries people's camera, microphone and conversations, so security reports are taken seriously.

## Reporting a vulnerability

Please report it privately through GitHub: **[Security → Report a vulnerability](https://github.com/mayerwin/sonora-live/security/advisories/new)**.
Do not open a public issue for it. You will get an answer within a few days, and credit in the fix if you wish.

Useful to include: what an attacker can do, the steps to reproduce, and the browsers concerned.

## Supported versions

Only the current version, published at <https://mayerwin.github.io/sonora-live/>, is supported. The installed app
updates itself to it.

## How Sonora Live is built to be safe

- Audio, video, chat, files and MIDI travel directly between the browsers, encrypted by WebRTC (DTLS-SRTP, SCTP over
  DTLS). There is no server of ours in the middle.
- The rendezvous messages exchanged through public MQTT brokers are encrypted (AES-GCM) with a key derived from the
  room code; the topic is a hash of the code.
- Files received in the chat keep their type only if it cannot run script (images, PDF, audio); anything else is
  downloaded rather than opened.
- Messages from other peers are validated and size-limited; names and chat text are rendered as text, never as HTML.
- The room code is the only secret of a lesson: share it only with the people you want in it, and keep the room locked
  (the default).
