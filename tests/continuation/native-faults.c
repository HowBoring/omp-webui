#define _GNU_SOURCE
#include <stdio.h>
#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <stdbool.h>
#include <stdlib.h>
#include <string.h>
#include <sys/resource.h>
#include <sys/socket.h>
#include <unistd.h>

/* Only a deliberately selected synthetic child may constrain its own native lease socket. */
static bool enabled(void) {
  const char *home = getenv("HOME"), *declared = getenv("OMP_STRICT_FIXTURE_HOME");
  const char *target = getenv("OMP_STRICT_FAULT_TARGET"), *fault = getenv("OMP_STRICT_FAULT");
  return home && declared && target && fault && !strcmp(home, declared) && !strcmp(fault, "unknown-lease")
    && !strncmp(target, home, strlen(home)) && target[strlen(home)] == '/';
}
int socket(int domain, int type, int protocol) {
  int (*actual)(int, int, int) = dlsym(RTLD_NEXT, "socket");
  if (domain != AF_UNIX || !enabled()) return actual(domain, type, protocol);
  struct rlimit previous, limited;
  if (getrlimit(RLIMIT_NOFILE, &previous)) return actual(domain, type, protocol);
  limited = previous; limited.rlim_cur = 3;
  if (setrlimit(RLIMIT_NOFILE, &limited)) return actual(domain, type, protocol);
  int result = actual(domain, type, protocol), error = errno;
  setrlimit(RLIMIT_NOFILE, &previous);
  if (result == -1 && error == EMFILE) {
    char file[4096]; snprintf(file, sizeof(file), "%s/strict-syscalls.log", getenv("HOME"));
    int fd = open(file, O_WRONLY | O_CREAT | O_APPEND | O_NOFOLLOW, 0600);
    if (fd >= 0) { const char event[] = "socket-real-emfile\n"; write(fd, event, sizeof(event) - 1); close(fd); }
  }
  errno = error; return result;
}
