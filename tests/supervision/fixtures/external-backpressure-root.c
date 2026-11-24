/* Fixed synthetic broker: no children, providers, Native loading or extra output. */
#include <string.h>
#include <unistd.h>

int main(int argc, char **argv) {
    char byte;
    if (argc != 2 || strcmp(argv[1], "__omp_worker_daemon_broker") != 0) return 74;
    return read(0, &byte, 1) == 1 && byte == 'X' ? 0 : 74;
}
