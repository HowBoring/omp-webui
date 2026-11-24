#define _POSIX_C_SOURCE 200809L

#include <stdint.h>
#include <time.h>

#ifndef __linux__
#error "The shutdown clock requires Linux CLOCK_MONOTONIC"
#endif

uint32_t omp_shutdown_clock_abi(void) {
    return UINT32_C(1);
}

/* Floor once to integer milliseconds. UINT64_MAX is reserved for failure. */
uint64_t omp_shutdown_clock_milliseconds(void) {
    struct timespec now;
    if (clock_gettime(CLOCK_MONOTONIC, &now) != 0 ||
        now.tv_sec < 0 || now.tv_nsec < 0 || now.tv_nsec >= 1000000000L) {
        return UINT64_MAX;
    }
    const uint64_t fraction = (uint64_t)(now.tv_nsec / 1000000L);
    const uintmax_t seconds = (uintmax_t)now.tv_sec;
    if (seconds > (UINT64_MAX - UINT64_C(1) - fraction) / UINT64_C(1000)) {
        return UINT64_MAX;
    }
    return (uint64_t)seconds * UINT64_C(1000) + fraction;
}
