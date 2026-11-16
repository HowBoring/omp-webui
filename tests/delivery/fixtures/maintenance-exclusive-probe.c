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

/* Independent finite kernel flock probe, never a Native worker or maintenance authority in the product. */
static int number(const char *value, uintmax_t *output) {
    if (!value || !*value || *value < '0' || *value > '9') return 0;
    char *end = NULL;
    errno = 0;
    *output = strtoumax(value, &end, 10);
    return errno == 0 && end && *end == '\0';
}
int main(int argc, char **argv) {
    uintmax_t device, inode;
    char canonical[PATH_MAX];
    if (argc != 4 || !number(argv[2], &device) || !number(argv[3], &inode) || !inode ||
        !realpath(argv[1], canonical) || strcmp(canonical, argv[1]) != 0) return 74;
    int fd = open(argv[1], O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
    if (fd < 0) return 74;
    struct stat held, named;
    int valid = fstat(fd, &held) == 0 && lstat(argv[1], &named) == 0 && S_ISREG(held.st_mode) &&
        S_ISREG(named.st_mode) && held.st_nlink == 1 && named.st_nlink == 1 &&
        held.st_uid == getuid() && named.st_uid == getuid() && (held.st_mode & 0777) == 0600 &&
        (named.st_mode & 0777) == 0600 && (uintmax_t)held.st_dev == device && (uintmax_t)named.st_dev == device &&
        (uintmax_t)held.st_ino == inode && (uintmax_t)named.st_ino == inode;
    if (!valid) { (void)close(fd); return 74; }
    int acquired = flock(fd, LOCK_EX | LOCK_NB) == 0;
    int error = errno;
    if (!acquired && error != EWOULDBLOCK && error != EAGAIN) { (void)close(fd); return 74; }
    const char *stage = acquired ? "EXCLUSIVE_ACQUIRED" : "EXCLUSIVE_REFUSED";
    int written = printf("{\"stage\":\"%s\",\"pid\":%ld}\n", stage, (long)getpid());
    int flushed = fflush(stdout);
    int closed = close(fd); /* Exactly one close; never retry a reusable numeric fd. */
    if (written < 0 || flushed != 0 || closed != 0) return 74;
    return acquired ? 0 : 73;
}
