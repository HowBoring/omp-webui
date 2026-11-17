#define _GNU_SOURCE
#include <ctype.h>
#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <limits.h>
#include <poll.h>
#include <signal.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/file.h>
#include <sys/prctl.h>
#include <sys/random.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <sys/un.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>
#include "../launcher/control.h"

/* Build pins OMP_NATIVE_ENTRY, OMP_CONTROL_*, OMP_FENCE_{PATH,DEVICE,INODE}, dispatcher endpoint/installation.
 * No shell/PATH lookup, Native imports, stdout/stderr writes or Host Session access.
 * Source-only until real kernel/dispatcher/Native proof; this executable alone grants no capability. */
#define CONTROL_FD 3
#define FRAME_BYTES 512
#define OUTPUT_FRAMES 16
#define CANDIDATE_BYTES 65536
#define CANDIDATE_COUNT 1024
#define ARGUMENT_COUNT 128
#define ARGUMENT_BYTES 16384
#define ENVIRONMENT_COUNT 256
#define ENVIRONMENT_BYTES 65536
#define POLL_MS 50
#define COOPERATIVE_MS UINT64_C(30000)
#define TERM_MS UINT64_C(5000)
#define DISPATCHER_MS UINT64_C(10000)
enum dispatcher_phase { CONNECTING, REGISTER_WRITE, REGISTER_READ, REGISTERED, COMPLETE_WRITE, COMPLETE_READ, ACKNOWLEDGED, LOST };
#ifndef P_PIDFD
#define P_PIDFD 3
#endif

#include "candidates.h"

struct supervisor {
    const char *generation;
    struct candidate_stream candidates;
    pid_t root;
    int root_pidfd;
    int barrier;
    int lock;
    int fence_directory;
    int fence;
    char fence_name[80];
    int started;
    int spawn_closed;
    int root_reaped;
    int control_open;
    int mandatory;
    int force;
    int term_sent;
    int incomplete;
    int hello_sent;
    int extinct;
    int root_exit_code;
    int root_exit_signal;
    int dispatcher;
    enum dispatcher_phase dispatcher_phase;
    char register_id[65];
    char complete_id[65];
    char helper_start[32];
    char native_start[32];
    char dispatcher_outgoing[FRAME_BYTES];
    size_t dispatcher_outgoing_length;
    size_t dispatcher_outgoing_offset;
    char dispatcher_incoming[FRAME_BYTES];
    size_t dispatcher_incoming_length;
    uint64_t dispatcher_deadline;
    uint64_t mandatory_at;
    char incoming[FRAME_BYTES];
    size_t incoming_length;
    char outgoing[OUTPUT_FRAMES][FRAME_BYTES];
    size_t outgoing_lengths[OUTPUT_FRAMES];
    size_t outgoing_head;
    size_t outgoing_count;
    size_t outgoing_offset;
};
static volatile sig_atomic_t interrupted;
static void caught_signal(int number) { (void)number; interrupted = 1; }
static uint64_t monotonic_ms(void) {
    struct timespec now;
    if (clock_gettime(CLOCK_MONOTONIC, &now) != 0) return UINT64_MAX;
    return (uint64_t)now.tv_sec * 1000 + (uint64_t)now.tv_nsec / 1000000;
}
static int hex_generation(const char *value) {
    if (strlen(value) != 64) return 0;
    for (size_t index = 0; index < 64; index++) {
        if (!((value[index] >= 'a' && value[index] <= 'f') || isdigit((unsigned char)value[index]))) return 0;
    }
    return 1;
}
static int emit(struct supervisor *state, const char *format, ...) {
    if (!state->control_open) return 1;
    if (state->outgoing_count == OUTPUT_FRAMES) return 0;
    size_t tail = (state->outgoing_head + state->outgoing_count) % OUTPUT_FRAMES;
    va_list arguments;
    va_start(arguments, format);
    int length = vsnprintf(state->outgoing[tail], FRAME_BYTES, format, arguments);
    va_end(arguments);
    if (length <= 0 || length >= FRAME_BYTES) return 0;
    state->outgoing_lengths[tail] = (size_t)length;
    state->outgoing_count++;
    return 1;
}
static void close_barrier(struct supervisor *state) {
    state->spawn_closed = 1;
    if (state->barrier >= 0) { close(state->barrier); state->barrier = -1; }
}
static void begin_mandatory(struct supervisor *state) {
    close_barrier(state);
    if (state->mandatory || state->force) return;
    state->mandatory = 1;
    state->mandatory_at = monotonic_ms();
    if (state->mandatory_at == UINT64_MAX) {
        state->incomplete = 1;
        (void)emit(state, "STATE %s incomplete\n", state->generation);
        return;
    }
    (void)emit(state, "STATE %s cooperative\n", state->generation);
}
static void lose_control(struct supervisor *state) {
    if (state->control_open) close(CONTROL_FD);
    state->control_open = 0;
    state->outgoing_count = 0;
    begin_mandatory(state);
}
static void unresolved(struct supervisor *state) {
    if (state->incomplete) return;
    state->incomplete = 1;
    if (!emit(state, "STATE %s incomplete\n", state->generation)) lose_control(state);
}
static void flush_control(struct supervisor *state) {
    while (state->control_open && state->outgoing_count) {
        size_t head = state->outgoing_head;
        ssize_t count = send(CONTROL_FD, state->outgoing[head] + state->outgoing_offset,
            state->outgoing_lengths[head] - state->outgoing_offset, MSG_DONTWAIT | MSG_NOSIGNAL);
        if (count < 0 && (errno == EAGAIN || errno == EINTR)) return;
        if (count <= 0) { lose_control(state); return; }
        state->outgoing_offset += (size_t)count;
        if (state->outgoing_offset == state->outgoing_lengths[head]) {
            state->outgoing_head = (head + 1) % OUTPUT_FRAMES;
            state->outgoing_count--;
            state->outgoing_offset = 0;
        }
    }
}
/* Parse /proc field22 without trusting a command name, with bounded reads. Identity hints only. */
static int start_time(pid_t pid, char *out, size_t capacity) {
    char path[80], bytes[4096];
    if (snprintf(path, sizeof(path), "/proc/%ld/stat", (long)pid) < 0) return 0;
    int fd = open(path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
    if (fd < 0) return 0;
    ssize_t length = read(fd, bytes, sizeof(bytes) - 1);
    close(fd);
    if (length <= 0 || length == (ssize_t)sizeof(bytes) - 1) return 0;
    bytes[length] = '\0';
    char *cursor = strrchr(bytes, ')');
    if (!cursor || cursor[1] != ' ') return 0;
    cursor += 2;
    for (int field = 3; field < 22; field++) {
        cursor = strchr(cursor, ' ');
        if (!cursor) return 0;
        cursor++;
    }
    char *end = strchr(cursor, ' ');
    if (!end || end == cursor || (size_t)(end - cursor) >= capacity) return 0;
    for (char *position = cursor; position < end; position++) if (!isdigit((unsigned char)*position)) return 0;
    memcpy(out, cursor, (size_t)(end - cursor));
    out[end - cursor] = '\0';
    return 1;
}
static int fence_directory_matches(int fd) {
    struct stat held, named;
    char canonical[PATH_MAX];
    return realpath(OMP_FENCE_PATH, canonical) && strcmp(canonical, OMP_FENCE_PATH) == 0 &&
        fstat(fd, &held) == 0 && lstat(OMP_FENCE_PATH, &named) == 0 &&
        S_ISDIR(held.st_mode) && S_ISDIR(named.st_mode) &&
        held.st_uid == getuid() && named.st_uid == getuid() && (held.st_mode & 077) == 0 && (named.st_mode & 077) == 0 &&
        (uintmax_t)held.st_dev == OMP_FENCE_DEVICE && (uintmax_t)named.st_dev == OMP_FENCE_DEVICE &&
        (uintmax_t)held.st_ino == OMP_FENCE_INODE && (uintmax_t)named.st_ino == OMP_FENCE_INODE;
}
static int protect_generation(struct supervisor *state) {
    state->lock = open(OMP_CONTROL_PATH, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
    if (state->lock < 0 || !omp_control_matches(state->lock)) return 0;
    if (flock(state->lock, LOCK_SH | LOCK_NB) != 0 || !omp_control_matches(state->lock)) return 0;
    state->fence_directory = open(OMP_FENCE_PATH, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    if (state->fence_directory < 0 || !fence_directory_matches(state->fence_directory)) return 0;
    if (snprintf(state->fence_name, sizeof(state->fence_name), "%s.fence", state->generation) < 0) return 0;
    state->fence = openat(state->fence_directory, state->fence_name,
        O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
    if (state->fence < 0) return 0;
    char record[FRAME_BYTES];
    int length = snprintf(record, sizeof(record), "omp-private-incomplete/1 %s %ld\n", state->generation, (long)getpid());
    if (length <= 0 || length >= (int)sizeof(record) || write(state->fence, record, (size_t)length) != length) return 0;
    return fsync(state->fence) == 0 && fsync(state->fence_directory) == 0 &&
        fence_directory_matches(state->fence_directory) && omp_control_matches(state->lock);
}
static int clear_fence(struct supervisor *state) {
    struct stat held, named;
    if (!fence_directory_matches(state->fence_directory) || !omp_control_matches(state->lock) ||
        fstat(state->fence, &held) != 0 || fstatat(state->fence_directory, state->fence_name, &named, AT_SYMLINK_NOFOLLOW) != 0 ||
        !S_ISREG(held.st_mode) || !S_ISREG(named.st_mode) || held.st_nlink != 1 || named.st_nlink != 1 ||
        held.st_dev != named.st_dev || held.st_ino != named.st_ino) return 0;
    /* Unlink follows proven extinction only; fsync failure remains unresolved and retains the shared lock. */
    if (unlinkat(state->fence_directory, state->fence_name, 0) != 0) return 0;
    if (fsync(state->fence_directory) == 0) return 1;
    /* Failure to recreate cannot authorize maintenance: retained helper lock + dispatcher fence remain mandatory. */
    int replacement = openat(state->fence_directory, state->fence_name, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0600);
    if (replacement >= 0) { (void)write(replacement, "unresolved\n", 11); (void)fsync(replacement); close(replacement); }
    return 0;
}
/* Reap owns every status in this dedicated domain. Only kernel ECHILD is an extinction endpoint. */
static int reap_children(struct supervisor *state) {
    for (size_t count = 0; count < CANDIDATE_COUNT; count++) {
        siginfo_t status;
        memset(&status, 0, sizeof(status));
        if (waitid(P_ALL, 0, &status, WEXITED | WNOHANG | __WALL) < 0) {
            if (errno == EINTR) continue;
            if (errno == ECHILD) return state->root_reaped && state->spawn_closed ? 1 : 0;
            unresolved(state);
            return 0;
        }
        if (status.si_pid == 0) return 0;
        if (status.si_pid == state->root && !state->root_reaped) {
            state->root_reaped = 1;
            close_barrier(state);
            state->root_exit_code = status.si_code == CLD_EXITED ? status.si_status : 0;
            state->root_exit_signal = status.si_code == CLD_EXITED ? 0 : status.si_status;
            if (state->hello_sent && !emit(state, "ROOT_EXIT %s %d %d\n", state->generation,
                state->root_exit_code, state->root_exit_signal)) lose_control(state);
        }
    }
    return 0;
}
/* Successful waitid(P_PIDFD) proves this held stable identity is our direct child. No numeric-PID kill exists. */
static int signal_child(int pidfd, int signal_number) {
    siginfo_t status;
    memset(&status, 0, sizeof(status));
    if (waitid(P_PIDFD, (id_t)pidfd, &status, WEXITED | WNOHANG | WNOWAIT | __WALL) < 0) {
        if (errno == ECHILD || errno == ESRCH) return 1; /* explicitly NO signal */
        return 0;
    }
    if (status.si_pid != 0) return 1; /* already waitable; next reap owns it */
    if (syscall(SYS_pidfd_send_signal, pidfd, signal_number, NULL, 0) < 0 && errno != ESRCH) return 0;
    return 1;
}
/* Discovery is never authority. Held root signaling cannot be hidden behind observer failure. */
static int signal_candidates(struct supervisor *state, int signal_number) {
    int result = state->root_reaped || signal_child(state->root_pidfd, signal_number);
    if (!candidate_begin(&state->candidates)) return 0;
    for (size_t count = 0; count < CANDIDATE_BATCH_PIDS; count++) {
        pid_t candidate = 0;
        int found = candidate_next(&state->candidates, &candidate);
        if (found < 0) return 0;
        if (found == 0) return result;
        int pidfd = (int)syscall(SYS_pidfd_open, candidate, 0);
        if (pidfd < 0) {
            if (errno != ESRCH) result = 0;
            continue;
        }
        if (!signal_child(pidfd, signal_number)) result = 0;
        close(pidfd); /* one ephemeral candidate handle; never convert back to a PID for signals */
    }
    return result;
}
static int start_root(struct supervisor *state) {
    if (state->started || state->spawn_closed || state->root_reaped) return 0;
    const char byte = 'S';
    ssize_t count;
    do { count = write(state->barrier, &byte, 1); } while (count < 0 && errno == EINTR);
    if (count != 1) return 0;
    state->started = 1;
    close_barrier(state); /* no later helper fork/exec can be admitted */
    return emit(state, "STATE %s running\n", state->generation);
}
static int command(struct supervisor *state, char *frame) {
    char *generation = strchr(frame, ' ');
    if (!generation) return 0;
    *generation++ = '\0';
    if (strcmp(generation, state->generation) != 0) return 0;
    if (strcmp(frame, "START") == 0) return start_root(state);
    if (strcmp(frame, "STATUS") == 0) {
        const char *phase = state->incomplete ? "incomplete" : state->force ? "kill" : state->term_sent ? "term" :
            state->mandatory ? "cooperative" : state->started ? "running" : "waiting";
        return emit(state, "STATE %s %s\n", state->generation, phase);
    }
    if (strcmp(frame, "ORDINARY_STOP") == 0) {
        if (!state->started || state->mandatory || state->force) return 0;
        return emit(state, "STATE %s ordinary\n", state->generation);
    }
    if (strcmp(frame, "MANDATORY") == 0) { begin_mandatory(state); return 1; }
    if (strcmp(frame, "FORCE") == 0) {
        close_barrier(state);
        state->force = 1;
        return emit(state, "STATE %s kill\n", state->generation);
    }
    return 0;
}
enum line_feed { LINE_INVALID = -1, LINE_PARTIAL, LINE_READY };
/* Framing only: callers retain independent command/ACK sequencing and per-channel read budgets. */
static enum line_feed ascii_line_byte(char *buffer, size_t *length, size_t capacity, unsigned char byte) {
    if (byte == '\n') {
        buffer[*length] = '\0';
        return LINE_READY;
    }
    if (byte < 32 || byte > 126 || *length >= capacity - 1) return LINE_INVALID;
    buffer[(*length)++] = (char)byte;
    return LINE_PARTIAL;
}
static void read_control(struct supervisor *state) {
    unsigned char incoming[FRAME_BYTES];
    /* One bounded read per poll; neither a chatty Host nor partial frames can monopolize reaping. */
    ssize_t amount = recv(CONTROL_FD, incoming, sizeof(incoming), MSG_DONTWAIT);
    if (amount < 0 && (errno == EAGAIN || errno == EINTR)) return;
    if (amount <= 0) { lose_control(state); return; }
    for (ssize_t index = 0; index < amount; index++) {
        enum line_feed result = ascii_line_byte(state->incoming, &state->incoming_length,
            sizeof(state->incoming), incoming[index]);
        if (result == LINE_INVALID) { lose_control(state); return; }
        if (result == LINE_READY) {
            if (!command(state, state->incoming)) { lose_control(state); return; }
            state->incoming_length = 0;
        }
    }
}
static void escalation(struct supervisor *state) {
    if (interrupted) begin_mandatory(state);
    if (state->mandatory && !state->force) {
        uint64_t now = monotonic_ms();
        if (now == UINT64_MAX || now < state->mandatory_at) { unresolved(state); return; }
        uint64_t elapsed = now - state->mandatory_at;
        if (elapsed >= COOPERATIVE_MS && !state->term_sent) {
            state->term_sent = 1;
            if (!emit(state, "STATE %s term\n", state->generation)) lose_control(state);
        }
        if (elapsed >= COOPERATIVE_MS + TERM_MS) {
            state->force = 1;
            if (!emit(state, "STATE %s kill\n", state->generation)) lose_control(state);
        }
    }
    if ((state->force || state->term_sent) && !signal_candidates(state, state->force ? SIGKILL : SIGTERM)) {
        unresolved(state);
    }
    if (state->force) unresolved(state); /* Force dispatch is not an extinction receipt. */
}
static int arguments_valid(int argc, char **argv) {
    if (argc < 4 || argc > ARGUMENT_COUNT + 2 || !hex_generation(argv[1]) || strcmp(argv[2], "--") != 0) return 0;
    size_t total = 0;
    for (int index = 3; index < argc; index++) {
        size_t length = strnlen(argv[index], ARGUMENT_BYTES + 1);
        if (length >= ARGUMENT_BYTES || total > ARGUMENT_BYTES - length - 1) return 0;
        total += length + 1;
    }
    /* This source is private RPC only; no externally protected lifetime can accidentally inherit EOF kill. */
    return argc >= 5 && strcmp(argv[3], "--mode") == 0 && strcmp(argv[4], "rpc-ui") == 0;
}
static int environment_valid(void) {
    extern char **environ;
    size_t total = 0, count = 0;
    for (char **entry = environ; *entry; entry++) {
        size_t length = strnlen(*entry, ENVIRONMENT_BYTES + 1);
        if (++count > ENVIRONMENT_COUNT || length >= ENVIRONMENT_BYTES || total > ENVIRONMENT_BYTES - length - 1) return 0;
        total += length + 1;
    }
    return 1;
}
static int control_valid(void) {
    struct stat metadata;
    int type = 0;
    socklen_t size = sizeof(type);
    if (fstat(CONTROL_FD, &metadata) != 0 || !S_ISSOCK(metadata.st_mode) ||
        getsockopt(CONTROL_FD, SOL_SOCKET, SO_TYPE, &type, &size) != 0 || type != SOCK_STREAM) return 0;
    return fcntl(CONTROL_FD, F_SETFD, FD_CLOEXEC) == 0 &&
        fcntl(CONTROL_FD, F_SETFL, fcntl(CONTROL_FD, F_GETFL) | O_NONBLOCK) == 0;
}
static void child_exec(int barrier, struct supervisor *state, char **arguments) {
    close(CONTROL_FD);
    if (state->candidates.directory) closedir(state->candidates.directory);
    close(state->lock);
    close(state->fence_directory);
    close(state->fence);
    if (state->barrier >= 0) close(state->barrier);
    unsigned char byte;
    ssize_t amount;
    do { amount = read(barrier, &byte, 1); } while (amount < 0 && errno == EINTR);
    close(barrier);
    if (amount != 1 || byte != 'S') _exit(74);
    struct sigaction normal;
    memset(&normal, 0, sizeof(normal));
    normal.sa_handler = SIG_DFL;
    sigemptyset(&normal.sa_mask);
    (void)sigaction(SIGTERM, &normal, NULL);
    (void)sigaction(SIGINT, &normal, NULL);
    (void)sigaction(SIGHUP, &normal, NULL);
    (void)sigaction(SIGPIPE, &normal, NULL);
    execv(OMP_NATIVE_ENTRY, arguments);
    _exit(74);
}
/* Independent operation IDs prevent a delayed registration acknowledgement becoming a completion receipt. */
static int random_id(char out[65]) {
    unsigned char bytes[32];
    size_t total = 0;
    for (int attempt = 0; attempt < 8 && total < sizeof(bytes); attempt++) {
        ssize_t count = getrandom(bytes + total, sizeof(bytes) - total, GRND_NONBLOCK);
        if (count < 0 && errno == EINTR) continue;
        if (count <= 0) return 0;
        total += (size_t)count;
    }
    if (total != sizeof(bytes)) return 0;
    const char hex[] = "0123456789abcdef";
    for (size_t index = 0; index < sizeof(bytes); index++) {
        out[index * 2] = hex[bytes[index] >> 4];
        out[index * 2 + 1] = hex[bytes[index] & 15];
    }
    out[64] = '\0';
    return 1;
}
static void dispatcher_lost(struct supervisor *state) {
    if (state->dispatcher >= 0) close(state->dispatcher);
    state->dispatcher = -1;
    state->dispatcher_phase = LOST;
    if (!state->hello_sent) close_barrier(state);
    /* Dispatcher loss globally fences classification; it never independently authorizes private force. */
    unresolved(state);
}
static int dispatcher_request(struct supervisor *state, int complete) {
    const char *operation = complete ? "complete_helper" : "register_helper";
    const char *id = complete ? state->complete_id : state->register_id;
    int length = snprintf(state->dispatcher_outgoing, FRAME_BYTES,
        "{\"version\":\"omp-execution-helper/1\",\"id\":\"%s\",\"installation\":\"%s\","
        "\"operation\":{\"op\":\"%s\",\"generation\":\"%s\"}}\n", id, OMP_INSTALLATION_ID, operation, state->generation);
    uint64_t now = monotonic_ms();
    if (length <= 0 || length >= FRAME_BYTES || now == UINT64_MAX) return 0;
    state->dispatcher_outgoing_length = (size_t)length;
    state->dispatcher_outgoing_offset = 0;
    state->dispatcher_incoming_length = 0;
    state->dispatcher_deadline = now + DISPATCHER_MS;
    state->dispatcher_phase = complete ? COMPLETE_WRITE : REGISTER_WRITE;
    return 1;
}
static int connect_dispatcher(struct supervisor *state) {
    if (!hex_generation(OMP_INSTALLATION_ID) || strlen(OMP_DISPATCHER_PATH) >= sizeof(((struct sockaddr_un *)0)->sun_path)) return 0;
    state->dispatcher = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC | SOCK_NONBLOCK, 0);
    if (state->dispatcher < 0) return 0;
    struct sockaddr_un address;
    memset(&address, 0, sizeof(address));
    address.sun_family = AF_UNIX;
    memcpy(address.sun_path, OMP_DISPATCHER_PATH, strlen(OMP_DISPATCHER_PATH) + 1);
    int result = connect(state->dispatcher, (struct sockaddr *)&address, sizeof(address));
    if (result < 0 && errno != EINPROGRESS && errno != EAGAIN) return 0;
    if (!dispatcher_request(state, 0)) return 0;
    if (result < 0) state->dispatcher_phase = CONNECTING;
    return 1;
}
static int dispatcher_peer(struct supervisor *state) {
    struct ucred peer;
    socklen_t length = sizeof(peer);
    return getsockopt(state->dispatcher, SOL_SOCKET, SO_PEERCRED, &peer, &length) == 0 &&
        length == sizeof(peer) && peer.uid == getuid();
}
static void dispatcher_write(struct supervisor *state) {
    if (state->dispatcher_phase == CONNECTING) {
        int error = 0;
        socklen_t length = sizeof(error);
        if (getsockopt(state->dispatcher, SOL_SOCKET, SO_ERROR, &error, &length) != 0 || error || !dispatcher_peer(state)) {
            dispatcher_lost(state); return;
        }
        state->dispatcher_phase = REGISTER_WRITE;
    }
    if (!dispatcher_peer(state)) { dispatcher_lost(state); return; }
    ssize_t count = send(state->dispatcher, state->dispatcher_outgoing + state->dispatcher_outgoing_offset,
        state->dispatcher_outgoing_length - state->dispatcher_outgoing_offset, MSG_DONTWAIT | MSG_NOSIGNAL);
    if (count < 0 && (errno == EAGAIN || errno == EINTR)) return;
    if (count <= 0) { dispatcher_lost(state); return; }
    state->dispatcher_outgoing_offset += (size_t)count;
    if (state->dispatcher_outgoing_offset == state->dispatcher_outgoing_length) {
        state->dispatcher_phase = state->dispatcher_phase == COMPLETE_WRITE ? COMPLETE_READ : REGISTER_READ;
    }
}
static int dispatcher_ack(struct supervisor *state) {
    int complete = state->dispatcher_phase == COMPLETE_READ;
    if (!complete && state->dispatcher_phase != REGISTER_READ) return 0;
    char expected[FRAME_BYTES];
    int length = snprintf(expected, sizeof(expected),
        "{\"version\":\"omp-execution-helper/1\",\"id\":\"%s\",\"ok\":true,\"operation\":\"%s\",\"generation\":\"%s\"}",
        complete ? state->complete_id : state->register_id, complete ? "complete_helper" : "register_helper", state->generation);
    if (length <= 0 || length >= FRAME_BYTES || strcmp(expected, state->dispatcher_incoming) != 0) return 0;
    state->dispatcher_phase = complete ? ACKNOWLEDGED : REGISTERED;
    if (complete) return 1;
    state->hello_sent = 1;
    if (!emit(state, "HELLO %s %ld %s %ld %s\n", state->generation, (long)getpid(), state->helper_start,
        (long)state->root, state->native_start) || !emit(state, "STATE %s waiting\n", state->generation)) return 0;
    if (state->root_reaped && !emit(state, "ROOT_EXIT %s %d %d\n", state->generation,
        state->root_exit_code, state->root_exit_signal)) return 0;
    return 1;
}
static void dispatcher_read(struct supervisor *state) {
    unsigned char bytes[FRAME_BYTES];
    ssize_t amount = recv(state->dispatcher, bytes, sizeof(bytes), MSG_DONTWAIT);
    if (amount < 0 && (errno == EAGAIN || errno == EINTR)) return;
    if (amount <= 0) { dispatcher_lost(state); return; }
    for (ssize_t index = 0; index < amount; index++) {
        enum line_feed result = ascii_line_byte(state->dispatcher_incoming, &state->dispatcher_incoming_length,
            sizeof(state->dispatcher_incoming), bytes[index]);
        if (result == LINE_INVALID) { dispatcher_lost(state); return; }
        if (result == LINE_READY) {
            if (!dispatcher_ack(state)) { dispatcher_lost(state); return; }
            state->dispatcher_incoming_length = 0;
            /* ACK channel alone forbids pipelining/duplicates, even after a first matching frame. */
            if (index != amount - 1) { dispatcher_lost(state); return; }
        }
    }
}
static void dispatcher_progress(struct supervisor *state) {
    enum dispatcher_phase phase = state->dispatcher_phase;
    if (phase == LOST || phase == REGISTERED || phase == ACKNOWLEDGED) return;
    uint64_t now = monotonic_ms();
    if (now == UINT64_MAX || now >= state->dispatcher_deadline) dispatcher_lost(state);
}
static int run(struct supervisor *state) {
    for (;;) {
        if (reap_children(state)) state->extinct = 1;
        if (state->extinct && state->dispatcher_phase == REGISTERED && !dispatcher_request(state, 1)) dispatcher_lost(state);
        if (state->extinct && state->dispatcher_phase == ACKNOWLEDGED) {
            if (!clear_fence(state)) { unresolved(state); }
            else {
                if (!emit(state, "COMPLETE %s\n", state->generation)) lose_control(state);
                flush_control(state);
                return state->outgoing_count == 0 ? 0 : 75;
            }
        }
        escalation(state);
        dispatcher_progress(state);
        flush_control(state);
        int writing = state->dispatcher_phase == CONNECTING || state->dispatcher_phase == REGISTER_WRITE ||
            state->dispatcher_phase == COMPLETE_WRITE;
        struct pollfd descriptors[2] = {
            { .fd = state->control_open ? CONTROL_FD : -1, .events = POLLIN | (state->outgoing_count ? POLLOUT : 0) },
            { .fd = state->dispatcher, .events = POLLIN | (writing ? POLLOUT : 0) }
        };
        int result = poll(descriptors, 2, POLL_MS);
        if (result < 0 && errno != EINTR) { unresolved(state); begin_mandatory(state); }
        if (result <= 0) continue;
        if (descriptors[0].revents & POLLIN) read_control(state);
        if (descriptors[0].revents & (POLLERR | POLLHUP | POLLNVAL)) lose_control(state);
        if (descriptors[1].revents & POLLOUT) dispatcher_write(state);
        if (state->dispatcher >= 0 && (descriptors[1].revents & POLLIN)) dispatcher_read(state);
        if (state->dispatcher >= 0 && (descriptors[1].revents & (POLLERR | POLLHUP | POLLNVAL))) dispatcher_lost(state);
    }
}
static int configure_signals(void) {
    struct sigaction action;
    memset(&action, 0, sizeof(action));
    action.sa_handler = caught_signal;
    sigemptyset(&action.sa_mask);
    if (sigaction(SIGTERM, &action, NULL) != 0 || sigaction(SIGINT, &action, NULL) != 0 ||
        sigaction(SIGHUP, &action, NULL) != 0 || signal(SIGPIPE, SIG_IGN) == SIG_ERR) return 0;
    struct sigaction child_default;
    memset(&child_default, 0, sizeof(child_default));
    child_default.sa_handler = SIG_DFL;
    sigemptyset(&child_default.sa_mask);
    if (sigaction(SIGCHLD, &child_default, NULL) != 0) return 0;
    return 1;
}
static int prepare_private_domain(struct supervisor *state) {
    int subreaper = 0;
    if (prctl(PR_SET_CHILD_SUBREAPER, 1) != 0 || prctl(PR_GET_CHILD_SUBREAPER, &subreaper) != 0 || subreaper != 1) return 0;
    /* Actual kernel probe, never an inferred kernel-version capability. A self pidfd must NOT grant child authority. */
    int self = (int)syscall(SYS_pidfd_open, getpid(), 0);
    if (self < 0) return 0;
    siginfo_t status;
    memset(&status, 0, sizeof(status));
    int tested = waitid(P_PIDFD, (id_t)self, &status, WEXITED | WNOHANG | WNOWAIT | __WALL);
    int supported = tested < 0 && errno == ECHILD;
    close(self);
    if (!supported || !candidate_open(&state->candidates) || !protect_generation(state)) return 0;
    if (!random_id(state->register_id) || !random_id(state->complete_id) || strcmp(state->register_id, state->complete_id) == 0 ||
        strcmp(state->register_id, state->generation) == 0 || strcmp(state->complete_id, state->generation) == 0) return 0;
    return 1;
}
static int launch_root(struct supervisor *state, char **argv) {
    int barrier[2];
    if (pipe2(barrier, O_CLOEXEC) != 0) return 0; /* Durable incomplete fence remains on startup failure. */
    state->barrier = barrier[1];
    state->root = fork();
    if (state->root < 0) return 0;
    if (state->root == 0) {
        argv[2] = OMP_NATIVE_ENTRY;
        child_exec(barrier[0], state, argv + 2);
    }
    close(barrier[0]);
    state->root_pidfd = (int)syscall(SYS_pidfd_open, state->root, 0);
    if (state->root_pidfd < 0 || !signal_child(state->root_pidfd, 0) ||
        !start_time(getpid(), state->helper_start, sizeof(state->helper_start)) ||
        !start_time(state->root, state->native_start, sizeof(state->native_start))) {
        unresolved(state); begin_mandatory(state);
    } else if (!connect_dispatcher(state)) dispatcher_lost(state);
    return 1;
}
int main(int argc, char **argv) {
    if (!arguments_valid(argc, argv) || !environment_valid() || !control_valid()) return 74;
    const char *injections[] = {"BUN_OPTIONS", "NODE_OPTIONS", "BUN_INSPECT", "LD_PRELOAD", "LD_LIBRARY_PATH", "LD_AUDIT"};
    for (size_t index = 0; index < sizeof(injections) / sizeof(injections[0]); index++) {
        if (getenv(injections[index]) != NULL) return 74;
    }
    struct supervisor state;
    memset(&state, 0, sizeof(state));
    state.generation = argv[1];
    state.root_pidfd = state.barrier = state.lock = state.fence_directory = state.fence = state.dispatcher = -1;
    state.dispatcher_phase = LOST;
    state.control_open = 1;
    if (!configure_signals() || !prepare_private_domain(&state) || !launch_root(&state, argv)) return 74;
    /* Allocate retained identities first so dispatcher writes cannot reuse fd1. Child exec is still held. */
    close(STDIN_FILENO); close(STDOUT_FILENO); close(STDERR_FILENO);
    return run(&state);
}
