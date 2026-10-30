# First-board reading source

`first-board.pdf` is an original, one-page Chinese practice document authored for Lumior's interactive first-board guide. It is bundled locally, contains a real selectable text layer, and does not require a model or network service.

`first-board-cover.png` is a reduced rendering of that same PDF, not a separate mockup. `first-board-metadata.json` records the PDF byte size and the exact percentage rectangle used by the prepared excerpt. The document uses the bundled Lumior Document Sans font; its SIL Open Font License is stored in `../pdf-fonts/OFL.txt`.

The original PDF-generation script is not included in this source snapshot. The checked-in PDF, cover, and metadata are the available editable-source starting point; do not rely on a regeneration command that is absent. If replacing the practice document, render the new PDF to update the cover, then update the byte size and excerpt rectangle in the metadata and `app/onboarding-model.ts` together.

The source URL includes an experience-board ID query parameter. This keeps each replay's editable annotations independent while serving the same bundled file.
