#ifndef OMP_DELIVERY_CONTROL_H
#define OMP_DELIVERY_CONTROL_H
#include <inttypes.h>
#include <limits.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

/* Shared stable-inode guard. Call before and after flock; never replace this control inode. */
static int omp_control_matches(int fd) {
    struct stat held, named;
    char canonical[PATH_MAX];
    return realpath(OMP_CONTROL_PATH, canonical) && strcmp(canonical, OMP_CONTROL_PATH) == 0 &&
        fstat(fd, &held) == 0 && lstat(OMP_CONTROL_PATH, &named) == 0 &&
        S_ISREG(held.st_mode) && S_ISREG(named.st_mode) && held.st_nlink == 1 && named.st_nlink == 1 &&
        (uintmax_t)held.st_dev == OMP_CONTROL_DEVICE && (uintmax_t)named.st_dev == OMP_CONTROL_DEVICE &&
        (uintmax_t)held.st_ino == OMP_CONTROL_INODE && (uintmax_t)named.st_ino == OMP_CONTROL_INODE;
}

#endif
