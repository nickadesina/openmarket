# Certificate schema fixture

`example-co/2026-01-15.json` is **not** a transcription. It is shaped like
`src/lib/ingest/parse/certificate.ts` so the parser and the importer can be
tested; the issuer (`example-co`, "Example Co, Inc.") and every term in it
are invented, its purchase URL is `example.com` and its PDF hash is all
zeros. No certificate of a real company is committed until one has been
bought and read (data/index/certificates/README.md).
