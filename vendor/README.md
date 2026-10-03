# Vendored dependencies

This directory contains source snapshots that are shipped inside the DesktopCommanderNoMCP npm package so the runtime can use narrowly hardened dependency graphs without changing the public Desktop Commander tool behavior.

## exceljs

- Upstream package: exceljs
- Upstream version: 4.4.0
- Upstream license: MIT (retained in vendor/exceljs/LICENSE)
- Upstream gitHead: `ac96f9a61e9799c7776bd940f05c4a51d7200209`
- npm tarball: `https://registry.npmjs.org/exceljs/-/exceljs-4.4.0.tgz`
- npm integrity: `sha512-XctvKaEMaj1Ii9oDOqbW/6e1gXknSY4g/aLCDicOXqBE4M0nRWkUu0PTp++UPNzoFY12BNHMfs/VadKIS6llvg==`
- Purpose here: preserve the verified Desktop Commander Excel API and the existing Windows/Node 24 streaming behavior while allowing the vulnerable uuid/tmp and deprecated fast-csv/unzipper dependency branches to be replaced by explicit root runtime dependencies.
- Reviewed differences from the official npm tarball: `package.json` is hardened for vendoring, `index.js` is added as the local wrapper entrypoint, and upstream `index.ts` is omitted so TypeScript consumes `index.d.ts` without compiling vendor source outside `src`.
- `lib/stream/xlsx/workbook-writer.js` is unchanged from the official ExcelJS 4.4.0 npm tarball. Streaming compatibility is preserved by keeping the compatible `archiver@5.3.2` runtime line; `archiver >=6` was explicitly RED in the Windows/Node 24 streaming regression test.
- Packaging change: vendored ExcelJS declares no npm runtime dependencies itself; the root package explicitly declares the required runtime libraries so Node resolves one shared dependency instance after npm/npx installation.

## md-to-pdf

- Upstream package: md-to-pdf
- Upstream version: 5.2.5
- Upstream license: MIT (retained in vendor/md-to-pdf/license)
- Upstream gitHead: `9e74457091a8e3f35f35113262ce406e92db0e9a`
- npm tarball: `https://registry.npmjs.org/md-to-pdf/-/md-to-pdf-5.2.5.tgz`
- npm integrity: `sha512-TG8TgDM0PmEwCldR6j/1QP9gBElLL3DSn5ID8P3bEXEl3Y2zHOUSyszHzabWnDNxklRjKbi40ybli8YQJ5Ym5w==`
- Purpose here: preserve the existing PDF API while replacing the vulnerable chokidar 3/braces runtime branch.
- Local dependency metadata change: chokidar is constrained to ^4.0.3. The root package explicitly declares the runtime dependencies needed by the vendored code.

`vendor/provenance.json` records the SHA-256 of every shipped vendor file. `scripts/verify-vendor-provenance.cjs` is the tamper-evident CI gate; `scripts/verify-vendor-upstream.cjs` re-fetches the integrity-pinned npm tarballs and checks the narrow local-change allowlist; `scripts/verify-vendor-advisories.cjs` queries OSV for direct advisories on the vendored package versions; and `scripts/verify-vendor-tracking.cjs` proves every provenance-listed file is present in the Git index.

The upstream `dist/` directories are intentionally tracked even though the repository globally ignores build `dist/` output: they are vendored runtime source inputs required by the npm package and MCPB bundle, not local build artifacts.

Do not remove the retained license files or the package publish/consumer regression tests when updating these snapshots. Any future vendor refresh must re-run the clean npm pack -> fresh consumer install -> runtime Excel/PDF exercises and npm audit --omit=dev.
