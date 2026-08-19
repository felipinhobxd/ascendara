# Security Policy

## Supported versions

Security fixes are applied to the latest supported Ascendara release. Users should update to the newest release before reporting an issue that may already have been fixed.

## Reporting a vulnerability

Please do not open a public issue for a vulnerability that could put Ascendara users at risk.

Use GitHub's private vulnerability reporting / Security Advisory flow for this repository when it is available. If private reporting is unavailable, contact the maintainers through an official Ascendara support channel and make it clear that the message contains a security report so details are not reposted publicly.

A useful report includes:

- the affected Ascendara version and operating system;
- the smallest set of steps needed to reproduce the issue;
- the security impact you believe is possible;
- logs or screenshots with personal data, API keys, tokens, and local paths removed;
- whether the issue has already been disclosed anywhere else.

## What to expect

We will first try to reproduce and understand the impact. Once the issue is confirmed, the priority is to ship a fix before publishing technical details that would make exploitation easier.

Please give the maintainers a reasonable opportunity to investigate and release a fix before public disclosure.

## Scope

Reports are especially useful when they involve:

- Electron renderer-to-main process boundaries;
- IPC validation or unintended privileged operations;
- unsafe file or path handling;
- authentication or session handling;
- update or release integrity;
- remote content gaining access to local application privileges;
- secrets or sensitive user information exposed by Ascendara itself.

Issues that only affect third-party services or content sources should normally be reported to the owner of that service unless Ascendara introduces the vulnerability.
