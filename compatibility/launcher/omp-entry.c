#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <unistd.h>

/* Build injects OMP_CONTROL_{PATH,DEVICE,INODE}. No PATH lookup, shell, configuration or native import occurs. */
#include "control.h"

static int canonical_member(char *out, size_t size, const char *root, const char *member) {
    char canonical[PATH_MAX];
    int written = snprintf(out, size, "%s/%s", root, member);
    if (written < 0 || (size_t)written >= size || !realpath(out, canonical) || strcmp(out, canonical) != 0) return 0;
    struct stat metadata;
    return lstat(out, &metadata) == 0 && S_ISREG(metadata.st_mode) && metadata.st_nlink == 1;
}

/* Explicit fixture build contract only; ordinary launchers retain their stage-local runtime. */
#ifdef OMP_TEST_HARNESS_RUNTIME_PATH
static int test_harness_runtime(char *out, size_t size) {
    const char *file = OMP_TEST_HARNESS_RUNTIME_PATH;
    char canonical[PATH_MAX];
    struct stat metadata;
    if (strcmp(file, "/workspace/work/rpc-public-module-probe/tooling/bun/package/bin/bun") != 0 ||
        !realpath(file, canonical) || strcmp(file, canonical) != 0 || lstat(file, &metadata) != 0 ||
        !S_ISREG(metadata.st_mode) || metadata.st_nlink != 1 || metadata.st_size != 107308936 ||
        metadata.st_uid != getuid() || (metadata.st_mode & 07777) != 0755 ||
        (uintmax_t)metadata.st_dev != OMP_TEST_HARNESS_RUNTIME_DEVICE ||
        (uintmax_t)metadata.st_ino != OMP_TEST_HARNESS_RUNTIME_INODE ||
        (uintmax_t)metadata.st_uid != OMP_TEST_HARNESS_RUNTIME_UID) return 0;
    int written = snprintf(out, size, "%s", file);
    return written >= 0 && (size_t)written < size;
}
#endif

int main(int argc, char **argv) {
    const char *injections[] = {"BUN_OPTIONS", "NODE_OPTIONS", "BUN_INSPECT", "LD_PRELOAD", "LD_LIBRARY_PATH", "LD_AUDIT"};
    for (size_t index = 0; index < sizeof(injections) / sizeof(injections[0]); index++) {
        if (getenv(injections[index]) != NULL) return 74;
    }
    const char reserved[] = "--omp-maintenance-handoff";
    for (int index = 1; index < argc; index++) {
        if (strncmp(argv[index], reserved, sizeof(reserved) - 1) == 0) return 74;
    }
    int lock = open(OMP_CONTROL_PATH, O_RDONLY | O_NOFOLLOW);
    if (lock < 0 || !omp_control_matches(lock)) return 74;
    if (flock(lock, LOCK_SH | LOCK_NB) != 0) return 73;
    if (!omp_control_matches(lock) || fcntl(lock, F_SETFD, 0) != 0) return 74;
    char root[PATH_MAX], runtime[PATH_MAX], target[PATH_MAX], config[PATH_MAX], config_flag[PATH_MAX + 16];
    ssize_t length = readlink("/proc/self/exe", root, sizeof(root) - 1);
    const char suffix[] = "/bin/omp";
    if (length < (ssize_t)sizeof(suffix) || length >= (ssize_t)sizeof(root) - 1) return 74;
    root[length] = '\0';
    if (strcmp(root + length - strlen(suffix), suffix) != 0) return 74;
    root[length - strlen(suffix)] = '\0';
#ifdef OMP_TEST_HARNESS_RUNTIME_PATH
    if (!test_harness_runtime(runtime, sizeof(runtime))) return 74;
#else
    if (!canonical_member(runtime, sizeof(runtime), root, "runtime/bun")) return 74;
#endif
    if (!canonical_member(target, sizeof(target), root, "worker/cli.js") ||
        !canonical_member(config, sizeof(config), root, "runtime/bunfig.toml")) return 74;
    if (snprintf(config_flag, sizeof(config_flag), "--config=%s", config) < 0) return 74;
    /* Shared lock stays open across exec. Children/shared services require separate native ownership proof. */
    char handoff[64];
    int handoff_length = snprintf(handoff, sizeof(handoff), "--omp-maintenance-handoff=1:%d", lock);
    if (handoff_length < 0 || (size_t)handoff_length >= sizeof(handoff)) return 74;
    char **command = calloc((size_t)argc + 5, sizeof(char *));
    if (!command) return 74;
    command[0] = runtime;
    command[1] = "--no-env-file";
    command[2] = config_flag;
    command[3] = target;
    command[4] = handoff;
    for (int index = 1; index < argc; index++) command[index + 4] = argv[index];
    execv(runtime, command);
    return 74;
}
