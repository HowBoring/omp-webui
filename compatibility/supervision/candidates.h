#ifndef OMP_PRIVATE_CANDIDATES_H
#define OMP_PRIVATE_CANDIDATES_H
#include <dirent.h>
#include <linux/magic.h>
#include <sys/vfs.h>

/* Discovery only. No candidate number ever grants wait/signal authority. The single owning thread checks pidfds. */
#define CANDIDATE_BATCH_NAMES 256
#define CANDIDATE_BATCH_PIDS 64
#define CANDIDATE_BATCH_MS UINT64_C(5)
#define CANDIDATE_PASS_NAMES 65536
#define CANDIDATE_PASS_BYTES (4 * 1024 * 1024)
#define CANDIDATE_PASS_MS UINT64_C(30000)
struct candidate_stream {
    DIR *directory;
    int failed;
    int loaded;
    char own_path[96];
    char snapshot[CANDIDATE_BYTES + 1];
    size_t length;
    size_t position;
    size_t own_count;
    size_t pass_names;
    size_t pass_bytes;
    size_t batch_names;
    uint64_t pass_at;
    uint64_t batch_at;
};
static uint64_t monotonic_ms(void);

static int own_status_integer(const char *bytes, const char *key, uintmax_t expected) {
    const char *line = strstr(bytes, key);
    if (!line) return 0;
    line += strlen(key);
    while (*line == ' ' || *line == '\t') line++;
    if (!isdigit((unsigned char)*line)) return 0;
    errno = 0;
    char *end;
    uintmax_t number = strtoumax(line, &end, 10);
    if (errno || number != expected) return 0;
    while (*end == ' ' || *end == '\t') end++;
    return *end == '\n' || *end == '\0';
}
/* Read own metadata only. Multi-level NSpid, different future-child namespace or ptrace is unsupported. */
static int proc_view_matches(void) {
    char self[32], expected[32], status[8193];
    ssize_t length = readlink("/proc/self", self, sizeof(self) - 1);
    if (length <= 0 || length >= (ssize_t)sizeof(self) - 1) return 0;
    self[length] = '\0';
    if (snprintf(expected, sizeof(expected), "%ld", (long)getpid()) <= 0 || strcmp(self, expected)) return 0;
    struct stat own_namespace, child_namespace;
    if (stat("/proc/self/ns/pid", &own_namespace) != 0 || stat("/proc/self/ns/pid_for_children", &child_namespace) != 0 ||
        own_namespace.st_dev != child_namespace.st_dev || own_namespace.st_ino != child_namespace.st_ino) return 0;
    int root = open("/proc", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    if (root < 0) return 0;
    struct statfs filesystem;
    int matches = fstatfs(root, &filesystem) == 0 && filesystem.f_type == PROC_SUPER_MAGIC;
    close(root);
    if (!matches) return 0;
    int file = open("/proc/self/status", O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
    if (file < 0) return 0;
    length = read(file, status, sizeof(status) - 1);
    close(file);
    if (length <= 0 || length == (ssize_t)sizeof(status) - 1) return 0;
    status[length] = '\0';
    return own_status_integer(status, "\nNSpid:", (uintmax_t)getpid()) &&
        own_status_integer(status, "\nThreads:", 1) && own_status_integer(status, "\nTracerPid:", 0);
}
#ifndef OMP_PROC_VIEW_ONLY
static int candidate_open(struct candidate_stream *stream) {
    memset(stream, 0, sizeof(*stream));
    if (!proc_view_matches()) return 0;
    int length = snprintf(stream->own_path, sizeof(stream->own_path), "/proc/self/task/%ld/children", (long)getpid());
    if (length <= 0 || length >= (int)sizeof(stream->own_path)) return 0;
    int file = open(stream->own_path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
    if (file >= 0) {
        char byte;
        ssize_t count = read(file, &byte, 1);
        close(file);
        return count == 0; /* Pre-fork, no child is admitted. */
    }
    if (errno != ENOENT) return 0;
    stream->directory = opendir("/proc");
    stream->pass_at = monotonic_ms();
    return stream->directory && stream->pass_at != UINT64_MAX;
}
static int candidate_begin(struct candidate_stream *stream) {
    stream->batch_at = monotonic_ms();
    stream->batch_names = 0;
    if (stream->directory && stream->pass_names == 0 && stream->pass_bytes == 0) stream->pass_at = stream->batch_at;
    return !stream->failed && stream->batch_at != UINT64_MAX;
}
/* 1: untrusted numeric candidate, 0: bounded yield/pass end, -1: unresolved observer failure. */
static int candidate_directory_next(struct candidate_stream *stream, pid_t *candidate) {
    for (;;) {
        uint64_t now = monotonic_ms();
        if (now == UINT64_MAX || now < stream->pass_at || now < stream->batch_at || now - stream->pass_at >= CANDIDATE_PASS_MS ||
            stream->pass_names >= CANDIDATE_PASS_NAMES || stream->pass_bytes >= CANDIDATE_PASS_BYTES) return -1;
        if (stream->batch_names >= CANDIDATE_BATCH_NAMES || now - stream->batch_at >= CANDIDATE_BATCH_MS) return 0;
        errno = 0;
        struct dirent *entry = readdir(stream->directory);
        if (!entry) {
            if (errno) return -1;
            rewinddir(stream->directory);
            stream->pass_names = stream->pass_bytes = 0;
            stream->pass_at = now;
            return 0; /* An empty/full pass is never an extinction endpoint. */
        }
        size_t length = strnlen(entry->d_name, 256);
        if (length >= 256) return -1;
        stream->pass_names++;
        stream->batch_names++;
        stream->pass_bytes += length + 1;
        if (stream->pass_bytes > CANDIDATE_PASS_BYTES) return -1;
        if (length == 0 || length > 10) continue;
        int numeric = 1;
        for (size_t index = 0; index < length; index++) {
            if (!isdigit((unsigned char)entry->d_name[index])) { numeric = 0; break; }
        }
        if (!numeric) continue;
        errno = 0;
        char *end;
        long number = strtol(entry->d_name, &end, 10);
        if (errno || *end || number <= 0 || number > INT_MAX) continue;
        *candidate = (pid_t)number;
        return 1;
    }
}
static int candidate_snapshot_next(struct candidate_stream *stream, pid_t *candidate) {
    uint64_t now = monotonic_ms();
    if (now == UINT64_MAX || now < stream->batch_at) return -1;
    if (stream->batch_names >= CANDIDATE_BATCH_NAMES || now - stream->batch_at >= CANDIDATE_BATCH_MS) return 0;
    if (!stream->loaded) {
        int file = open(stream->own_path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
        if (file < 0) return -1;
        size_t total = 0;
        size_t attempts = 0;
        while (total < sizeof(stream->snapshot)) {
            uint64_t read_at = monotonic_ms();
            if (++attempts > 64 || read_at == UINT64_MAX || read_at < stream->batch_at ||
                read_at - stream->batch_at >= CANDIDATE_BATCH_MS) { close(file); return -1; }
            ssize_t count = read(file, stream->snapshot + total, sizeof(stream->snapshot) - total);
            if (count < 0 && errno == EINTR) continue;
            if (count < 0) { close(file); return -1; }
            if (count == 0) break;
            total += (size_t)count;
        }
        close(file);
        if (total > CANDIDATE_BYTES) return -1;
        stream->snapshot[total] = '\0';
        stream->position = stream->own_count = 0;
        stream->length = total;
        stream->loaded = 1;
    }
    char *cursor = stream->snapshot + stream->position;
    while (*cursor == ' ' || *cursor == '\n') cursor++;
    if (!*cursor) { stream->loaded = 0; return 0; }
    if (++stream->own_count > CANDIDATE_COUNT || !isdigit((unsigned char)*cursor)) return -1;
    errno = 0;
    char *end;
    long number = strtol(cursor, &end, 10);
    if (errno || number <= 0 || number > INT_MAX || (*end && *end != ' ' && *end != '\n')) return -1;
    stream->position = (size_t)(end - stream->snapshot);
    stream->batch_names++;
    *candidate = (pid_t)number;
    return 1;
}
static int candidate_next(struct candidate_stream *stream, pid_t *candidate) {
    int result = stream->directory ? candidate_directory_next(stream, candidate) : candidate_snapshot_next(stream, candidate);
    if (result < 0) stream->failed = 1;
    return result;
}
#endif /* !OMP_PROC_VIEW_ONLY */
#endif
