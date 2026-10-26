# go-mtpx local patch

Source: https://github.com/ganeshrvel/go-mtpx/tree/18f12db021cc
Version: v0.0.0-20240426092756-18f12db021cc (the existing Kalam dependency).

This directory contains the production Go sources and module metadata from that pinned version. No upstream license file was present in the module archive; this snapshot does not assign a new license to upstream code.

Local changes:

- `DownloadFilesWithWalker` accepts a transfer-scoped traversal callback. `DownloadFiles` still delegates to the original traversal by default.
- The injected traversal replaces both preprocessing and direct-transfer path lookup. The redundant `GetObjectFromPath` call before traversal is removed.
- `IsDisallowedFile` exposes the existing filename filter.

The USB byte reader remains upstream code. Download safety now adds total-space preflight (also when overall progress is hidden), per-file/periodic capacity checks, cancellation checkpoints, and temporary-file writes followed by flush/size validation and atomic replacement. Failed or cancelled files do not truncate an existing destination. Uploads do not use this download path. The parent `go.mod` replaces the existing dependency with this directory; no new package or version is added.

- `DownloadFilesWithOptions` supplies cancellation and free-space checks. Total demand is computed from unique planned destinations, plus a 64 MiB reserve. Existing files are not credited as free space.
- `download_safety.go` checks the destination filesystem and cleans the current temporary file on cooperative interruption. Force quitting/crashing can still leave a hidden `.openmtp-*.part` file.
- A successful download replaces the existing destination only after the temporary file is flushed, closed and size-validated. Completed-file counts advance after that commit.
- The module's minimum Go version is 1.16 for the temporary-file API, matching the parent native module.
