###########################################################
# Focus Wizard — Docker image for the C++ SmartSpectra bridge
#
# Builds on Ubuntu 22.04 which has public .deb packages
# for the SmartSpectra SDK. This lets Mac/Windows users
# run the C++ bridge in Docker with a volume-mounted
# frame directory.
#
# Build:
#   docker build -t focus-wizard-bridge -f bridge/Dockerfile .
#
# Run:
#   docker run --rm \
#     -v /tmp/focus-wizard-frames:/frames \
#     -e SMARTSPECTRA_API_KEY=YOUR_KEY \
#     focus-wizard-bridge \
#     --mode=server \
#     --file_stream_path=/frames/frame0000000000000000.jpg
###########################################################

FROM --platform=linux/amd64 ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=Etc/UTC

# ── Base build tools & system dependencies ────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential git curl gpg ca-certificates \
        software-properties-common lsb-release wget gnupg \
        libcurl4-openssl-dev libssl-dev pkg-config \
        libv4l-dev libgles2-mesa-dev libunwind-dev \
        libopencv-dev \
    && rm -rf /var/lib/apt/lists/*

# ── CMake 3.27+ (Ubuntu 22.04 ships 3.22, too old) ───────
RUN wget -O - https://apt.kitware.com/keys/kitware-archive-latest.asc 2>/dev/null \
        | gpg --dearmor - | tee /etc/apt/trusted.gpg.d/kitware.gpg >/dev/null \
    && echo "deb https://apt.kitware.com/ubuntu/ $(lsb_release -cs) main" \
        | tee /etc/apt/sources.list.d/kitware.list >/dev/null \
    && apt-get update && apt-get install -y --no-install-recommends cmake \
    && rm -rf /var/lib/apt/lists/*

# ── SmartSpectra SDK from Presage PPA ─────────────────────
RUN curl -s "https://presage-security.github.io/PPA/KEY.gpg" \
        | gpg --dearmor | tee /etc/apt/trusted.gpg.d/presage-technologies.gpg >/dev/null \
    && curl -s --compressed -o /etc/apt/sources.list.d/presage-technologies.list \
        "https://presage-security.github.io/PPA/presage-technologies.list" \
    && apt-get update && apt-get install -y --no-install-recommends libsmartspectra-dev \
    && rm -rf /var/lib/apt/lists/*

# ── Copy bridge source & build ────────────────────────────
COPY bridge/ /opt/focus-bridge/
WORKDIR /opt/focus-bridge

RUN mkdir -p build && cd build \
    && cmake -G "Unix Makefiles" -DCMAKE_BUILD_TYPE=Release .. \
    && make -j$(nproc)

# ── Create the frame directory mount point ────────────────
RUN mkdir -p /frames

# ── Runtime ───────────────────────────────────────────────
ENTRYPOINT ["/opt/focus-bridge/build/focus_bridge"]
CMD []
