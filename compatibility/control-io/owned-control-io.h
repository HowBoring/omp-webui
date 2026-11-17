#ifndef OMP_OWNED_CONTROL_IO_H
#define OMP_OWNED_CONTROL_IO_H
#include <stdint.h>
#define OMP_CONTROL_IO_EXPORT __attribute__((visibility("default")))
#define OMP_CONTROL_IO_ABI 1u
#define OMP_CONTROL_IO_HANDLES 64u
#define OMP_CONTROL_IO_BYTES 512u
/* All calls are synchronous and main-thread only. Buffers are borrowed only for the call.
 * >=0 is a byte count (recv 0 means EOF); negatives below are stable, NOT negated errno. */
enum omp_control_io_status {
    OMP_IO_BLOCKED = -1, OMP_IO_INTERRUPTED = -2, OMP_IO_HANDLE = -3,
    OMP_IO_ARGUMENT = -4, OMP_IO_SYSTEM = -5, OMP_IO_LIMIT = -6,
    OMP_IO_NOT_SOCKET = -7, OMP_IO_CLOSE_UNCERTAIN = -8
};
/* diagnostic[0] receives a bounded immediate errno (0..4095). No errno accessor/global JS state. */
OMP_CONTROL_IO_EXPORT uint32_t omp_control_io_abi(void);
/* Returns a positive generation handle or 0. result[0] = status, result[1] = bounded errno.
 * Failure NEVER closes or changes fd. Success transfers sole caller ownership (no dup). */
OMP_CONTROL_IO_EXPORT uint32_t omp_control_io_adopt(int fd, int32_t result[2]);
OMP_CONTROL_IO_EXPORT int32_t omp_control_io_receive(uint32_t handle, void *bytes, uint32_t capacity, uint32_t diagnostic[1]);
OMP_CONTROL_IO_EXPORT int32_t omp_control_io_send(uint32_t handle, const void *bytes, uint32_t length, uint32_t diagnostic[1]);
/* Invalidates BEFORE one close; error/EINTR can never be retried with this handle or numeric fd. */
OMP_CONTROL_IO_EXPORT int32_t omp_control_io_close(uint32_t handle, uint32_t diagnostic[1]);
OMP_CONTROL_IO_EXPORT uint32_t omp_control_io_live(void);
#endif
