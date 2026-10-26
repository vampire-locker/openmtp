# go-mtpx local patch

Source: https://github.com/ganeshrvel/go-mtpx/tree/18f12db021cc
Version: v0.0.0-20240426092756-18f12db021cc (the existing Kalam dependency).

Production sources and module metadata are from the pinned upstream version. No license file was present in that module archive; this snapshot does not assign a new license to upstream code.

`DownloadFilesWithWalker` accepts an injected traversal and avoids the redundant per-source path lookup. `DownloadFiles` retains the original traversal by default. `IsDisallowedFile` exposes the existing filename filter. USB byte reads, local writes, timestamps and upload behavior remain upstream code.
