# Proposals

Ideas for future improvements that go beyond fixing current issues.

## Multi-stage build for the sandbox

The [Dockerfile](Dockerfile) installs build tools (gcc, cmake, autoconf, etc.)
and the full Rust toolchain in the final image, making it quite large. A
multi-stage build could separate the build-time dependencies from the runtime
image, significantly reducing image size — if those tools aren't needed
interactively at runtime.

Tradeoff: users currently have full build toolchains available inside the
sandbox, which is convenient for ad-hoc compilation. A multi-stage build would
require deciding up front what needs to be available at runtime.
