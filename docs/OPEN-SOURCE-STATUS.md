# Open-source project status

Initial source release: 2026-10-30. Repository: [limanman-design/lumior-community](https://github.com/limanman-design/lumior-community).

- Main license: [Apache-2.0](../LICENSE), selected by the project owner on 2026-10-30. Third-party components retain their own licenses.
- Included: application, desktop runtime, personal-key AI, product skills/templates, original pet/Memory Atlas content, reviewed runtime assets and public tests.
- Excluded: official gateway/admin, operational records, secrets, deployment configuration, private workspace snapshots, demo media and private Git history.
- Community application identity/data/update settings are separated from official builds. Official releases are prepared explicitly.
- This source includes OpenAI model-list, Windows icon and Obsidian storage changes. Availability in official installers depends on the release; see the website for current downloads.

Public source and official desktop releases are maintained separately. Community builds use their own data directory and do not receive official automatic updates.

Clean-source dependency installation, public tests, production builds and an isolated macOS community-package smoke test have passed. Windows native large-library import/backup acceptance has not been performed. Binary releases require review of the notices for the actual packaged dependencies. Report security issues privately using [SECURITY.md](../SECURITY.md).
