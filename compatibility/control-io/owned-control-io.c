#define _GNU_SOURCE
#include "owned-control-io.h"
#include <errno.h>
#include <limits.h>
#include <stddef.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/un.h>
#include <unistd.h>

/* No thread, callback, process identity, signal, listener, allocation, duplicated fd or retained buffer.
 * Generation exhaustion retires the slot permanently instead of ever wrapping onto a stale handle. */
struct owned_socket { int fd; uint32_t generation; int live; };
static struct owned_socket sockets[OMP_CONTROL_IO_HANDLES];
static uint32_t bounded_errno(int value) { return value > 0 && value <= 4095 ? (uint32_t)value : 0; }
static int32_t failure(int value, uint32_t *diagnostic) {
    *diagnostic = bounded_errno(value);
    if (value == EAGAIN || value == EWOULDBLOCK) return OMP_IO_BLOCKED;
    if (value == EINTR) return OMP_IO_INTERRUPTED;
    return OMP_IO_SYSTEM;
}
static struct owned_socket *lookup(uint32_t handle) {
    if (handle == 0) return NULL;
    uint32_t slot = (handle - 1u) % OMP_CONTROL_IO_HANDLES;
    uint32_t generation = (handle - 1u) / OMP_CONTROL_IO_HANDLES;
    struct owned_socket *socket = &sockets[slot];
    return socket->live && socket->generation == generation ? socket : NULL;
}
uint32_t omp_control_io_abi(void) { return OMP_CONTROL_IO_ABI; }
uint32_t omp_control_io_live(void) {
    uint32_t count = 0;
    for (uint32_t index = 0; index < OMP_CONTROL_IO_HANDLES; index++) count += sockets[index].live != 0;
    return count;
}
uint32_t omp_control_io_adopt(int fd, int32_t result[2]) {
    if (result == NULL) return 0;
    result[0] = OMP_IO_ARGUMENT; result[1] = 0;
    if (fd < 0) return 0;
    for (uint32_t index = 0; index < OMP_CONTROL_IO_HANDLES; index++) {
        if (sockets[index].live && sockets[index].fd == fd) { result[0] = OMP_IO_HANDLE; return 0; }
    }
    struct stat stat;
    int type = 0;
    socklen_t type_length = sizeof(type);
    struct sockaddr_un address;
    socklen_t address_length = sizeof(address);
    if (fstat(fd, &stat) != 0 || getsockopt(fd, SOL_SOCKET, SO_TYPE, &type, &type_length) != 0
        || getsockname(fd, (struct sockaddr *)&address, &address_length) != 0) {
        result[0] = OMP_IO_SYSTEM; result[1] = (int32_t)bounded_errno(errno); return 0;
    }
    if (!S_ISSOCK(stat.st_mode) || type_length != sizeof(type) || type != SOCK_STREAM
        || address_length < sizeof(sa_family_t) || address.sun_family != AF_UNIX) {
        result[0] = OMP_IO_NOT_SOCKET; return 0;
    }
    for (uint32_t index = 0; index < OMP_CONTROL_IO_HANDLES; index++) {
        struct owned_socket *socket = &sockets[index];
        if (socket->live || socket->generation >= (UINT32_MAX - OMP_CONTROL_IO_HANDLES) / OMP_CONTROL_IO_HANDLES) continue;
        socket->generation++;
        socket->fd = fd; socket->live = 1;
        result[0] = 0;
        return socket->generation * OMP_CONTROL_IO_HANDLES + index + 1u;
    }
    result[0] = OMP_IO_LIMIT; return 0;
}
int32_t omp_control_io_receive(uint32_t handle, void *bytes, uint32_t capacity, uint32_t diagnostic[1]) {
    if (diagnostic == NULL) return OMP_IO_ARGUMENT;
    *diagnostic = 0;
    struct owned_socket *socket = lookup(handle);
    if (socket == NULL) return OMP_IO_HANDLE;
    if (bytes == NULL || capacity == 0 || capacity > OMP_CONTROL_IO_BYTES) return OMP_IO_ARGUMENT;
    ssize_t count = recv(socket->fd, bytes, capacity, MSG_DONTWAIT);
    return count < 0 ? failure(errno, diagnostic) : (int32_t)count;
}
int32_t omp_control_io_send(uint32_t handle, const void *bytes, uint32_t length, uint32_t diagnostic[1]) {
    if (diagnostic == NULL) return OMP_IO_ARGUMENT;
    *diagnostic = 0;
    struct owned_socket *socket = lookup(handle);
    if (socket == NULL) return OMP_IO_HANDLE;
    if (bytes == NULL || length == 0 || length > OMP_CONTROL_IO_BYTES) return OMP_IO_ARGUMENT;
    ssize_t count = send(socket->fd, bytes, length, MSG_DONTWAIT | MSG_NOSIGNAL);
    return count < 0 ? failure(errno, diagnostic) : (int32_t)count;
}
int32_t omp_control_io_close(uint32_t handle, uint32_t diagnostic[1]) {
    if (diagnostic == NULL) return OMP_IO_ARGUMENT;
    *diagnostic = 0;
    struct owned_socket *socket = lookup(handle);
    if (socket == NULL) return OMP_IO_HANDLE;
    int fd = socket->fd;
    socket->live = 0; socket->fd = -1;
    if (close(fd) == 0) return 0;
    *diagnostic = bounded_errno(errno);
    return OMP_IO_CLOSE_UNCERTAIN; /* NEVER retry: Linux may already have reused this number. */
}
