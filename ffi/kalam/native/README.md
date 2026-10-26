## Large-directory listing

Non-recursive UI listings use the existing `go-mtpfs` transaction API to request five explicit `GetObjectPropList` properties. The implementation is in `directory/` and `list_directory.go`; it does not add or upgrade Go dependencies. The ALL-properties shortcut is deliberately avoided because the tested Xiaomi device rejects it.

Directory enumeration uses a bounded 120-second USB timeout and restores the original timeout afterward. Root directories and devices without compatible bulk-property support use standard object reads. Transport errors abort the listing instead of returning incomplete results. `operation_lock.go` serializes exported operations on the shared device session. Download traversal uses the transfer-scoped index described below; the USB byte reader remains upstream, while download safety uses temporary-file commits.

Run the new native tests with Go and libusb development files installed:

```sh
cd ffi/kalam/native
go test ./directory .
```

To build the macOS 26+ arm64 variant from the project root (Go 1.26+):

```sh
node_modules/.bin/zx ffi/kalam/native/scripts/build-arm-seg5.mjs
```

The script uses the pinned libusb bottle and existing Go module versions. Do not run `go get -u` merely to build this fix. Other platform binaries must be rebuilt using their appropriate toolchains before distributing the fix on those platforms. The checked-in `kalam-seg5.dylib` and header include the fix; the classic and Intel binaries have not been rebuilt.

See `tests/file-explorer/README.md` at the repository root for simulation and real-device results. The optional `KALAM_CAPTURE_DIR` test reads already captured local responses; captures contain filenames and must not be committed.

### Initial setup

```shell
#install node 16 or above
npm -g i nvm

#use node 16 or above
nvm use 16

#install zx globally
npm install -g --allow-scripts=zx zx@5.0.0
```

```shell script
xcode-select --install
brew install llvm gcc pkg-config libusb
nano ~/.zshrc
```

- Add these line to the ~/.zshrc file

```shell
export PATH="/opt/homebrew/opt/llvm/bin:$PATH"
export LDFLAGS="-L/opt/homebrew/opt/llvm/lib"
export CPPFLAGS="-I/opt/homebrew/opt/llvm/include"
```

```shell
source ~/.zshrc
```

### Build

- Add the required changes to the kalam kernel (./openmtp/ffi/kalam/native)

```shell script
cd ffi/kalam/native
go mod download
```

- Upgrade a go package

```shell
cd ffi/kalam/native

# go get github.com/<org-name>/<package-name>@<git-commit-hash>

#example: go get github.com/ganeshrvel/go-mtpfs@<git-commit-hash>
#example: go get github.com/ganeshrvel/go-mtpx@<git-commit-hash>
```

```shell
# cd  to the project root (ie ./openmtp)
cd </path/to/openmtp/>
zx ./ffi/kalam/native/scripts/build.mjs
```

**Troubleshooting**

- If you keep getting `fatal error: 'stdlib.h' file not found xcode`, then:
- Add these line to the ~/.zshrc file (`nano ~/.zshrc`)

```shell
export SDKROOT=$(xcrun --sdk macosx --show-sdk-path)
```

```shell
source ~/.zshrc
```

- In case of permission error with sentry follow this url: https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally#manually-change-npms-default-directory

# Do not follow the instructions below. These are old commands are they are maintained just for the sake of documentation

- Remove libusb `brew remove libusb`
- Download the required versions of the `libusb`.
  - Refer `Brew download for another OS version` for more
- Copy the `/path/to/libusb/arm64_big_sur/1.0.25/lib/libusb-1.0.0.dylib` to the `build/mac/bin/libusb.dylib`
- Make a backup copy of `/path/to/libusb/arm64_big_sur/1.0.25/lib/libusb-1.0.0.dylib`
- change the `rpath` using: `install_name_tool -id @loader_path/libusb.dylib /path/to/libusb/arm64_big_sur/1.0.25/lib/libusb-1.0.0.dylib`
- Open `/path/to/libusb/arm64_big_sur/1.0.25/lib/pkgconfig/libusb-1.0.pc`
  - Edit `prefix=@@HOMEBREW_CELLAR@@/libusb/1.0.25` as `prefix=/path/to/libusb/amd64_mojave/1.0.25`
  - Save it
- Example commands to build the kalam go binaries:

##### Examples:

```shell
(
        cd ./ffi/kalam/native && CGO_ENABLED=1 \
        PKG_CONFIG_PATH='/path/to/libusb/arm64_big_sur/1.0.25/lib/pkgconfig' \
        CGO_CFLAGS='-Wno-deprecated-declarations' \
        GOARCH=arm64 GOOS=darwin \
        go build \
        -v -a -trimpath \
        -o ../../../build/mac/bin/arm64/kalam.dylib -buildmode=c-shared ./*.go
    )
```

```shell
(
        cd ./ffi/kalam/native && CGO_ENABLED=1 \
        PKG_CONFIG_PATH='/path/to/libusb/arm64_big_sur/1.0.25/lib/pkgconfig' \
        CGO_CFLAGS='-Wno-deprecated-declarations' \
        GOARCH=arm64 GOOS=darwin \
        go build \
        -v -a -trimpath \
        -o ../../../build/mac/bin/arm64/kalam_debug_report kalam_debug_report/*.go
    )
```

## Do not follow the sections below anymore. These commands are deprecated

### libusb otool commands:

Build:

```shell
brew install libusb
brew info libusb
```

- Copy the path in the terminal; eg: `/opt/homebrew/Cellar/libusb/1.0.25`

```shell script
sudo install_name_tool -id "@loader_path/libusb.dylib" <libusb-path>/lib/libusb-1.0.0.dylib

# eg: sudo install_name_tool -id "@loader_path/libusb.dylib" /opt/homebrew/Cellar/libusb/1.0.25/lib/libusb-1.0.0.dylib

cp /opt/homebrew/Cellar/libusb/1.0.25/lib/libusb-1.0.dylib  ./build/mac/bin/libusb.dylib
```

## Large-selection download preparation

`directory/download_walker.go` builds a fresh directory/name/handle index for each download. It lists each distinct source directory once, including recursive selections, and uses known directory handles for nested traversal. Both overall-progress modes use this path; disabling preprocessing no longer falls back to per-file path searches. The cache is discarded at the end of the transfer and is never reused across device sessions.

The existing pinned `go-mtpx` dependency is provided under `third_party/go-mtpx` with a small local API patch, selected by `go.mod`'s `replace` directive. `DownloadFilesWithWalker` accepts the indexed traversal while retaining the upstream byte reader and adding the download safety rules below. No new dependency/version is added. See that directory's README for source provenance and the exact patch scope.

Native download callbacks are synchronous and throttled, avoiding the former unsynchronized progress-sharing goroutine. The JS bridge reports native errors as errors, never as successful completion. Preparation is labelled separately from copying and the progress dialog is cleared on failure.

Only the new transfer-related tests:

```sh
cd ffi/kalam/native
go test ./directory -run 'TestDownload|TestInjected'
# From the repository root:
node tests/file-explorer/transfer-errors.js
```

## Download space checks and stopping

Downloads always prepare a task-local plan before writing, including when overall progress is hidden. Preflight requires the complete planned byte count plus a 64 MiB reserve on the destination volume; it deliberately does not assume overwritten files will free space. Capacity is checked again for each file and periodically while writing. Errors fail closed.

Each file is written to a hidden `.openmtp-*.part` file in its destination directory, flushed, closed and size-validated, then atomically replaces its final path. Cooperative cancellation or errors remove that temporary file and retain any existing destination. A force kill or crash cannot run cleanup and may leave a `.part` file.

`CancelDownload(transferId)` signals a specific download without taking the USB-operation lock. The bridge creates a unique task ID and the progress dialog exposes **Stop copying** for compatible Kalam downloads. The control is disabled while stopping. Cancellation is checked between protocol operations and write chunks; an in-flight USB operation may have to return or time out (up to the directory timeout during preparation). Interrupted reads close the MTP session; refresh/reconnect before a new transfer. This is stopping, not pause/resume or persistent transfer resumption. Upload cancellation is not implemented.

The safety tests use simulated capacities and local temporary files; no actual disk-filling test is needed:

```sh
cd ffi/kalam/native
go test github.com/ganeshrvel/go-mtpx . ./send_to_js -run 'TestSpace|TestAtomic|TestFreeSpace|TestDownloadCancellation|TestDownloadSafety'
```
