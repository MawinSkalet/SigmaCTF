FROM --platform=$BUILDPLATFORM ubuntu:24.04 AS build
RUN apt-get update && apt-get install -y --no-install-recommends gcc-x86-64-linux-gnu binutils libc6-dev-amd64-cross \
    && ([ -f /usr/bin/as ] || ln -s /usr/bin/x86_64-linux-gnu-as /usr/bin/as) \
    && rm -rf /var/lib/apt/lists/*
COPY overflow.c /src/overflow.c
RUN x86_64-linux-gnu-gcc /src/overflow.c -o /sigma-overflow -O0 -fno-stack-protector -fno-pie -no-pie -fcf-protection=none -Wl,--build-id=none -Wl,-z,noexecstack
FROM ubuntu:24.04
RUN apt-get update && apt-get install -y --no-install-recommends socat coreutils && rm -rf /var/lib/apt/lists/*
COPY --from=build /sigma-overflow /challenge
COPY run.sh /run.sh
RUN chmod 555 /challenge /run.sh
USER 10001:10001
EXPOSE 30001
CMD ["/run.sh"]
